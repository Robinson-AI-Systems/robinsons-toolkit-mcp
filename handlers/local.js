import { currentWorkspace, currentWriteRoots } from '../src/core/context.js';
/**
 * Local Machine Handler — 61 tools
 * Complete local PC bridge: filesystem, git, npm/node,
 * environment, processes, system info, and Super Tools.
 * Runs in WSL2/Linux, currentWorkspace() scopes all relative paths.
 */

import { execSync } from '../src/core/sandbox/restricted-host.js';
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync,
  statSync, existsSync, unlinkSync, copyFileSync, renameSync, rmSync
} from 'fs';
import { join, resolve, dirname, basename, extname, relative } from 'path';
import { promisify } from 'util';
import { exec } from '../src/core/sandbox/restricted-host.js';
import { createHash } from 'crypto';
import { memoryUsage, cpuUsage } from '../src/core/system-metrics.js';
import { assertWriteAllowed } from '../src/core/sandbox/restricted-host.js';

const execAsync = promisify(exec);


function resolvePath(p) {
  if (!p) return currentWorkspace();
  if (p.match(/^[A-Za-z]:\\/)) return p; // Absolute Windows path
  if (p.startsWith('/')) return p;         // Absolute Unix path
  return join(currentWorkspace(), p);          // Relative to workspace
}

function checkWriteAllowed(p) {
  if (currentWriteRoots()) return assertWriteAllowed(p, currentWriteRoots());
  const allowed = process.env.ALLOWED_WRITE_PATHS;
  const roots = allowed
    ? allowed.split(',').map(s => s.trim()).filter(Boolean).map(p => resolve(p))
    : [currentWorkspace()];
  assertWriteAllowed(p, roots);
}

function isBinary(buffer) {
  const sample = buffer.slice(0, 512);
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte === 0) return true;
    if (byte < 8 || (byte > 13 && byte < 32 && byte !== 27)) return true;
  }
  return false;
}

async function git(command, cwd) {
  const { stdout, stderr } = await execAsync(`git ${command}`, { cwd: cwd || currentWorkspace() });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function execute(tool, args) {

  // ── TERMINAL / COMMANDS ────────────────────────────────────────────────────
  if (tool === 'local_run_command') {
    const { command, cwd, timeout_ms = 30000 } = args;
    if (!command) throw new Error('command is required');
    const workdir = cwd ? resolvePath(cwd) : currentWorkspace();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workdir, timeout: timeout_ms,
        maxBuffer: 10 * 1024 * 1024, shell: true, windowsHide: true
      });
      return { success: true, stdout: stdout || '', stderr: stderr || '', command, cwd: workdir };
    } catch (err) {
      return { success: false, error: err.message, stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code, command, cwd: workdir };
    }
  }

  // Run a script file (Node.js, bash, python, etc.)
  if (tool === 'local_run_script') {
    const { script_path, args: scriptArgs = [], cwd, interpreter, timeout_ms = 60000 } = args;
    if (!script_path) throw new Error('script_path is required');
    const fullPath = resolvePath(script_path);
    if (!existsSync(fullPath)) throw new Error(`Script not found: ${fullPath}`);
    const ext = extname(fullPath).toLowerCase();
    const interp = interpreter || (ext === '.py' ? 'python3' : ext === '.sh' ? 'bash' : 'node');
    const workdir = cwd ? resolvePath(cwd) : dirname(fullPath);
    const argStr = scriptArgs.map(a => `"${a}"`).join(' ');
    const command = `${interp} "${fullPath}" ${argStr}`.trim();
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: workdir, timeout: timeout_ms, maxBuffer: 10 * 1024 * 1024 });
      return { success: true, stdout: stdout || '', stderr: stderr || '', command, script: fullPath };
    } catch (err) {
      return { success: false, error: err.message, stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code };
    }
  }

  // ── FILE SYSTEM: READ ──────────────────────────────────────────────────────
  if (tool === 'local_read_file') {
    const { path: p, encoding = 'utf-8', max_lines } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) throw new Error(`Path is a directory, not a file: ${fullPath}`);
    const raw = readFileSync(fullPath);
    if (isBinary(raw)) return { path: fullPath, binary: true, size_bytes: stat.size, note: 'Binary file — use local_get_file_hash or local_get_file_info instead.' };
    let content = raw.toString(encoding);
    if (max_lines) content = content.split('\n').slice(0, max_lines).join('\n');
    return { path: fullPath, content, size_bytes: stat.size, modified: stat.mtime.toISOString(), lines: content.split('\n').length };
  }

  if (tool === 'local_read_multiple_files') {
    const { paths } = args;
    if (!paths?.length) throw new Error('paths array is required');
    const results = {};
    for (const p of paths) {
      try {
        const fullPath = resolvePath(p);
        results[p] = readFileSync(fullPath, 'utf-8');
      } catch (e) { results[p] = `ERROR: ${e.message}`; }
    }
    return results;
  }

  // Read and parse a JSON file
  if (tool === 'local_read_json') {
    const { path: p } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const content = readFileSync(fullPath, 'utf-8');
    try {
      return { path: fullPath, data: JSON.parse(content) };
    } catch (e) {
      throw new Error(`Invalid JSON in ${fullPath}: ${e.message}`);
    }
  }

  // Read a CSV file as array of objects
  if (tool === 'local_read_csv') {
    const { path: p, limit = 100, delimiter = ',' } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const lines = readFileSync(fullPath, 'utf-8').split('\n').filter(l => l.trim());
    if (!lines.length) return { path: fullPath, rows: [], headers: [] };
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1, limit + 1).map(line => {
      const vals = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
    return { path: fullPath, headers, rows, total_rows: lines.length - 1, showing: rows.length };
  }

  // Get detailed stat info for a file or directory
  if (tool === 'local_get_file_info') {
    const { path: p } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`Path not found: ${fullPath}`);
    const stat = statSync(fullPath);
    const ext = extname(fullPath);
    let extra = {};
    if (stat.isFile()) {
      const raw = readFileSync(fullPath);
      extra = { binary: isBinary(raw), extension: ext || '(none)', lines: isBinary(raw) ? null : raw.toString().split('\n').length };
    }
    return {
      path: fullPath, name: basename(fullPath), type: stat.isDirectory() ? 'directory' : 'file',
      size_bytes: stat.size, size_human: stat.size > 1048576 ? `${(stat.size/1048576).toFixed(2)} MB` : stat.size > 1024 ? `${(stat.size/1024).toFixed(1)} KB` : `${stat.size} B`,
      created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString(), accessed: stat.atime.toISOString(), ...extra
    };
  }

  // Get MD5 or SHA256 hash of a file
  if (tool === 'local_get_file_hash') {
    const { path: p, algorithm = 'sha256' } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const hash = createHash(algorithm).update(readFileSync(fullPath)).digest('hex');
    return { path: fullPath, algorithm, hash, size_bytes: statSync(fullPath).size };
  }

  // Count lines, words, characters in a file
  if (tool === 'local_count_lines') {
    const { path: p } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter(w => w.length > 0).length;
    return { path: fullPath, lines: lines.length, words, characters: content.length, blank_lines: lines.filter(l => !l.trim()).length };
  }

  // Show diff between two files
  if (tool === 'local_compare_files') {
    const { path_a, path_b, context_lines = 3 } = args;
    if (!path_a || !path_b) throw new Error('path_a and path_b are required');
    const a = resolvePath(path_a), b = resolvePath(path_b);
    if (!existsSync(a)) throw new Error(`File not found: ${a}`);
    if (!existsSync(b)) throw new Error(`File not found: ${b}`);
    try {
      const { stdout } = await execAsync(`diff -u${context_lines} "${a}" "${b}"`);
      return { identical: true, diff: '', path_a: a, path_b: b };
    } catch (err) {
      // diff exits with code 1 when files differ
      return { identical: false, diff: err.stdout || '', path_a: a, path_b: b };
    }
  }

  // ── FILE SYSTEM: WRITE ─────────────────────────────────────────────────────
  if (tool === 'local_write_file') {
    const { path: p, content, create_dirs = true } = args;
    if (!p || content === undefined) throw new Error('path and content are required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    if (create_dirs) mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath, bytes_written: Buffer.byteLength(content, 'utf-8') };
  }

  if (tool === 'local_append_file') {
    const { path: p, content } = args;
    if (!p || content === undefined) throw new Error('path and content are required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
    writeFileSync(fullPath, existing + content, 'utf-8');
    return { success: true, path: fullPath };
  }

  // Write a JavaScript object to a JSON file (pretty-printed)
  if (tool === 'local_write_json') {
    const { path: p, data, indent = 2, create_dirs = true } = args;
    if (!p || data === undefined) throw new Error('path and data are required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    if (create_dirs) mkdirSync(dirname(fullPath), { recursive: true });
    const content = JSON.stringify(data, null, indent) + '\n';
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath, bytes_written: Buffer.byteLength(content, 'utf-8') };
  }

  // Find-and-replace text within a single file
  if (tool === 'local_replace_in_file') {
    const { path: p, find, replace, all = true, regex = false } = args;
    if (!p || !find || replace === undefined) throw new Error('path, find, and replace are required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    let content = readFileSync(fullPath, 'utf-8');
    const original = content;
    if (regex) {
      const flags = all ? 'g' : '';
      content = content.replace(new RegExp(find, flags), replace);
    } else {
      if (all) {
        content = content.split(find).join(replace);
      } else {
        content = content.replace(find, replace);
      }
    }
    writeFileSync(fullPath, content, 'utf-8');
    const occurrences = all ? (original.split(find).length - 1) : (original.includes(find) ? 1 : 0);
    return { success: true, path: fullPath, occurrences_replaced: occurrences };
  }

  // Find-and-replace across multiple files in a directory
  if (tool === 'local_find_and_replace') {
    const { directory, find, replace, extensions = ['.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.env'], dry_run = false } = args;
    if (!find || replace === undefined) throw new Error('find and replace are required');
    const dir = resolvePath(directory || '');
    const changed = [];

    function processDir(d, depth = 0) {
      if (depth > 8) return;
      for (const entry of readdirSync(d)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
        const full = join(d, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) { processDir(full, depth + 1); continue; }
        if (!extensions.some(ext => entry.endsWith(ext))) continue;
        try {
          const content = readFileSync(full, 'utf-8');
          if (!content.includes(find)) continue;
          const count = content.split(find).length - 1;
          if (!dry_run) {
            checkWriteAllowed(full);
            writeFileSync(full, content.split(find).join(replace), 'utf-8');
          }
          changed.push({ file: relative(dir, full), occurrences: count });
        } catch { continue; }
      }
    }

    processDir(dir);
    return { dry_run, find, replace, files_changed: changed.length, files: changed, directory: dir };
  }

  // ── FILE SYSTEM: DELETE / MOVE / COPY ─────────────────────────────────────
  if (tool === 'local_delete_file') {
    const { path: p } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    unlinkSync(fullPath);
    return { success: true, deleted: fullPath };
  }

  if (tool === 'local_copy_file') {
    const { source, destination, overwrite = false } = args;
    if (!source || !destination) throw new Error('source and destination are required');
    const src = resolvePath(source), dst = resolvePath(destination);
    checkWriteAllowed(dst);
    if (!existsSync(src)) throw new Error(`Source not found: ${src}`);
    if (existsSync(dst) && !overwrite) throw new Error(`Destination exists. Set overwrite: true to replace.`);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    return { success: true, source: src, destination: dst };
  }

  // Move or rename a file or directory
  if (tool === 'local_move_file') {
    const { source, destination, overwrite = false } = args;
    if (!source || !destination) throw new Error('source and destination are required');
    const src = resolvePath(source), dst = resolvePath(destination);
    checkWriteAllowed(src);
    checkWriteAllowed(dst);
    if (!existsSync(src)) throw new Error(`Source not found: ${src}`);
    if (existsSync(dst) && !overwrite) throw new Error(`Destination exists. Set overwrite: true to replace.`);
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    return { success: true, moved_from: src, moved_to: dst };
  }

  // ── DIRECTORY OPERATIONS ───────────────────────────────────────────────────
  if (tool === 'local_list_directory') {
    const { path: p, recursive = false, include_hidden = false, filter_ext } = args;
    const fullPath = resolvePath(p || '');
    if (!existsSync(fullPath)) throw new Error(`Directory not found: ${fullPath}`);

    function listDir(dir, depth = 0) {
      const items = [];
      for (const entry of readdirSync(dir)) {
        if (!include_hidden && entry.startsWith('.')) continue;
        const entryPath = join(dir, entry);
        const stat = statSync(entryPath);
        const rel = relative(fullPath, entryPath);
        if (filter_ext && stat.isFile() && !entry.endsWith(filter_ext)) continue;
        items.push({ name: entry, path: rel, type: stat.isDirectory() ? 'directory' : 'file', size_bytes: stat.isFile() ? stat.size : undefined, modified: stat.mtime.toISOString() });
        if (recursive && stat.isDirectory() && depth < 5) items.push(...listDir(entryPath, depth + 1));
      }
      return items;
    }

    const items = listDir(fullPath);
    return { path: fullPath, items, total: items.length, files: items.filter(i => i.type === 'file').length, directories: items.filter(i => i.type === 'directory').length };
  }

  // local_make_directory and local_create_directory are the same thing
  if (tool === 'local_make_directory' || tool === 'local_create_directory') {
    const { path: p } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    mkdirSync(fullPath, { recursive: true });
    return { success: true, path: fullPath };
  }

  // Delete a directory and all its contents (rm -rf)
  if (tool === 'local_delete_directory') {
    const { path: p, dry_run = false } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);
    if (!existsSync(fullPath)) throw new Error(`Directory not found: ${fullPath}`);
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${fullPath}`);
    if (dry_run) {
      const { stdout } = await execAsync(`find "${fullPath}" | wc -l`);
      return { dry_run: true, path: fullPath, would_delete_files: parseInt(stdout.trim()) };
    }
    rmSync(fullPath, { recursive: true, force: true });
    return { success: true, deleted: fullPath };
  }

  // Copy an entire directory recursively
  if (tool === 'local_copy_directory') {
    const { source, destination, overwrite = false } = args;
    if (!source || !destination) throw new Error('source and destination are required');
    const src = resolvePath(source), dst = resolvePath(destination);
    checkWriteAllowed(dst);
    if (!existsSync(src)) throw new Error(`Source not found: ${src}`);
    if (existsSync(dst) && !overwrite) throw new Error(`Destination exists. Set overwrite: true to replace.`);
    const { stdout, stderr } = await execAsync(`cp -r "${src}" "${dst}"`);
    return { success: true, source: src, destination: dst };
  }

  // Get total size of a directory
  if (tool === 'local_get_directory_size') {
    const { path: p } = args;
    const fullPath = resolvePath(p || '');
    if (!existsSync(fullPath)) throw new Error(`Path not found: ${fullPath}`);
    const { stdout } = await execAsync(`du -sb "${fullPath}"`);
    const bytes = parseInt(stdout.split('\t')[0]);
    const { stdout: fileCount } = await execAsync(`find "${fullPath}" -type f | wc -l`);
    return {
      path: fullPath, size_bytes: bytes,
      size_human: bytes > 1073741824 ? `${(bytes/1073741824).toFixed(2)} GB` : bytes > 1048576 ? `${(bytes/1048576).toFixed(2)} MB` : `${(bytes/1024).toFixed(1)} KB`,
      file_count: parseInt(fileCount.trim())
    };
  }

  // Count files grouped by extension in a directory
  if (tool === 'local_count_files') {
    const { path: p, include_hidden = false } = args;
    const dir = resolvePath(p || '');
    const counts = {};

    function countIn(d, depth = 0) {
      if (depth > 8) return;
      try {
        for (const entry of readdirSync(d)) {
          if (!include_hidden && entry.startsWith('.')) continue;
          if (entry === 'node_modules' || entry === '.git') continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) { countIn(full, depth + 1); continue; }
          const ext = extname(entry) || '(no extension)';
          counts[ext] = (counts[ext] || 0) + 1;
        }
      } catch { }
    }

    countIn(dir);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { directory: dir, total_files: total, by_extension: Object.fromEntries(sorted) };
  }

  // List files sorted by size (largest first)
  if (tool === 'local_list_files_by_size') {
    const { path: p, limit = 20, min_size_bytes = 0 } = args;
    const dir = resolvePath(p || '');
    const { stdout } = await execAsync(`find "${dir}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs ls -s 2>/dev/null | sort -rn | head -${limit}`);
    const files = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [size, ...pathParts] = line.trim().split(/\s+/);
      return { path: pathParts.join(' ').replace(dir, '').replace(/^\//, ''), size_kb: parseInt(size) };
    }).filter(f => f.size_kb * 1024 >= min_size_bytes);
    return { directory: dir, files };
  }

  // List files sorted by modification date (newest first)
  if (tool === 'local_list_files_by_date') {
    const { path: p, limit = 20 } = args;
    const dir = resolvePath(p || '');
    const { stdout } = await execAsync(`find "${dir}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -printf "%T@ %p\n" | sort -rn | head -${limit}`);
    const files = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [ts, ...pathParts] = line.split(' ');
      const filePath = pathParts.join(' ');
      return { path: filePath.replace(dir, '').replace(/^\//, ''), modified: new Date(parseFloat(ts) * 1000).toISOString() };
    });
    return { directory: dir, files };
  }

  // ── FILE SEARCH ────────────────────────────────────────────────────────────
  // local_find_files and local_search_files both work (same logic)
  if (tool === 'local_find_files' || tool === 'local_search_files') {
    const { directory, pattern, content_search, contains } = args;
    const search = content_search || contains; // support both arg names
    const dir = resolvePath(directory || '');

    function findFiles(d, depth = 0) {
      if (depth > 6) return [];
      const results = [];
      try {
        for (const entry of readdirSync(d)) {
          if (entry.startsWith('.') || entry === 'node_modules') continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) { results.push(...findFiles(full, depth + 1)); continue; }
          if (pattern && !entry.includes(pattern) && !full.includes(pattern)) continue;
          if (search) {
            try {
              const raw = readFileSync(full);
              if (isBinary(raw)) continue;
              const text = raw.toString();
              if (!text.includes(search)) continue;
              const matchLines = text.split('\n').map((l, i) => ({ line: i + 1, text: l })).filter(l => l.text.includes(search));
              results.push({ path: relative(dir, full), matches: matchLines.slice(0, 5), total_matches: matchLines.length });
            } catch { continue; }
          } else {
            results.push({ path: relative(dir, full), size: stat.size, modified: stat.mtime.toISOString() });
          }
        }
      } catch { }
      return results;
    }

    const found = findFiles(dir);
    return { directory: dir, results: found, total: found.length };
  }

  // ── ENVIRONMENT / CONFIG ───────────────────────────────────────────────────
  if (tool === 'local_read_env_file') {
    const { path: p } = args;
    const fullPath = resolvePath(p || '.env');
    if (!existsSync(fullPath)) throw new Error(`Env file not found: ${fullPath}`);
    const content = readFileSync(fullPath, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      const value = rest.join('=');
      vars[key.trim()] = value.trim() ? '***' : '(empty)';
    }
    return { path: fullPath, variables: vars, variable_count: Object.keys(vars).length, note: 'Values masked. Use local_get_env to read a specific key.' };
  }

  // Read a specific key's value from .env (returns actual value — use carefully)
  if (tool === 'local_get_env') {
    const { key, path: p, env_file } = args;
    if (!key) throw new Error('key is required');
    const fullPath = resolvePath(p || env_file || '.env');
    if (!existsSync(fullPath)) throw new Error(`Env file not found: ${fullPath}`);
    const content = readFileSync(fullPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      if (k === key) {
        const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        return { key, value: v, found: true, env_file: fullPath };
      }
    }
    return { key, found: false, env_file: fullPath };
  }

  // local_update_env_var and local_set_env both work (same logic)
  if (tool === 'local_update_env_var' || tool === 'local_set_env') {
    const { path: p, env_file, key, value } = args;
    if (!key || value === undefined) throw new Error('key and value are required');
    const fullPath = resolvePath(p || env_file || '.env');
    checkWriteAllowed(fullPath);
    let content = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
    const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    const newLine = `${key}=${value}`;
    if (keyPattern.test(content)) {
      content = content.replace(keyPattern, newLine);
    } else {
      content = content.trimEnd() + '\n' + newLine + '\n';
    }
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, key, path: fullPath, action: 'set' };
  }

  if (tool === 'local_get_system_info') {
    const [nodeVer, npmVer, gitVer, diskInfo] = await Promise.all([
      execAsync('node --version').catch(() => ({ stdout: 'unknown' })),
      execAsync('npm --version').catch(() => ({ stdout: 'unknown' })),
      execAsync('git --version').catch(() => ({ stdout: 'unknown' })),
      execAsync('df -h / 2>/dev/null | tail -1').catch(() => ({ stdout: '' }))
    ]);
    const diskParts = diskInfo.stdout.trim().split(/\s+/);
    return {
      workspace_root: currentWorkspace(), platform: process.platform, arch: process.arch,
      node_version: nodeVer.stdout.trim(), npm_version: npmVer.stdout.trim(), git_version: gitVer.stdout.trim(),
      disk_total: diskParts[1] || 'unknown', disk_used: diskParts[2] || 'unknown', disk_available: diskParts[3] || 'unknown',
      env_vars_set: Object.keys(process.env).length, cwd: process.cwd()
    };
  }

  // Get disk usage stats
  if (tool === 'local_get_disk_usage') {
    const { stdout } = await execAsync('df -h 2>/dev/null');
    const lines = stdout.trim().split('\n');
    const header = lines[0];
    const mounts = lines.slice(1).map(line => {
      const parts = line.split(/\s+/);
      return { filesystem: parts[0], size: parts[1], used: parts[2], available: parts[3], use_percent: parts[4], mounted_on: parts[5] };
    }).filter(m => m.filesystem && !m.filesystem.startsWith('tmpfs'));
    return { mounts };
  }

  // Check if a port is in use
  if (tool === 'local_check_port') {
    const { port } = args;
    if (!port) throw new Error('port is required');
    try {
      const { stdout } = await execAsync(`ss -tlnp 2>/dev/null | grep ":${port} " || echo "not in use"`);
      const inUse = !stdout.includes('not in use') && stdout.trim().length > 0;
      return { port, in_use: inUse, detail: stdout.trim() || 'Port is free' };
    } catch {
      return { port, in_use: false, detail: 'Could not check port status' };
    }
  }

  // List running processes (filtered by name)
  if (tool === 'local_get_processes') {
    const { filter } = args;
    const cmd = filter ? `ps aux | grep -i "${filter}" | grep -v grep` : 'ps aux | head -30';
    const { stdout } = await execAsync(cmd).catch(() => ({ stdout: '' }));
    const lines = stdout.trim().split('\n').filter(Boolean).slice(0, 30);
    const procs = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(' ') };
    });
    return { processes: procs, count: procs.length };
  }

  // Open a URL in the default browser (WSL2 uses cmd.exe)
  if (tool === 'local_open_url') {
    const { url } = args;
    if (!url) throw new Error('url is required');
    const cmd = process.platform === 'win32' ? `start "${url}"` : `which xdg-open > /dev/null 2>&1 && xdg-open "${url}" || cmd.exe /c start "${url}"`;
    await execAsync(cmd).catch(() => {});
    return { success: true, url, message: 'Opened in default browser' };
  }

  // ── GIT OPERATIONS ─────────────────────────────────────────────────────────
  if (tool === 'local_git_status') {
    const { directory } = args;
    const cwd = resolvePath(directory || '');
    const [status, branch, log] = await Promise.all([
      execAsync('git status --porcelain', { cwd }).catch(e => ({ stdout: '', stderr: e.message })),
      execAsync('git branch --show-current', { cwd }).catch(() => ({ stdout: '(detached)' })),
      execAsync('git log --oneline -5', { cwd }).catch(() => ({ stdout: '' }))
    ]);
    return {
      branch: branch.stdout.trim(), status: status.stdout.trim(),
      recent_commits: log.stdout.trim(), has_changes: status.stdout.trim().length > 0,
      staged: status.stdout.split('\n').filter(l => l.match(/^[MADRCU]/)).length,
      unstaged: status.stdout.split('\n').filter(l => l.match(/^.[MADRCU?]/)).length
    };
  }

  // local_git_log (was in registry, not handler — now implemented)
  if (tool === 'local_git_log') {
    const { directory, limit = 20, format = 'oneline', author, since, branch } = args;
    const cwd = resolvePath(directory || '');
    let cmd = `git log --oneline -${limit}`;
    if (author) cmd += ` --author="${author}"`;
    if (since) cmd += ` --since="${since}"`;
    if (branch) cmd += ` ${branch}`;
    if (format === 'full') cmd = `git log -${limit} --pretty=format:"%H|%an|%ae|%ai|%s"${author ? ` --author="${author}"` : ''}${since ? ` --since="${since}"` : ''}`;
    const { stdout } = await execAsync(cmd, { cwd }).catch(e => { throw new Error(`Git error: ${e.message}`); });
    if (format === 'full') {
      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, author, email, date, ...msgParts] = line.split('|');
        return { hash, author, email, date, message: msgParts.join('|') };
      });
      return { commits, count: commits.length };
    }
    return { log: stdout.trim(), count: stdout.trim().split('\n').filter(Boolean).length };
  }

  // Show current unstaged or staged diff
  if (tool === 'local_git_diff') {
    const { directory, staged = false, file } = args;
    const cwd = resolvePath(directory || '');
    const stagedFlag = staged ? '--cached ' : '';
    const fileArg = file ? `-- "${file}"` : '';
    const { stdout } = await execAsync(`git diff ${stagedFlag}${fileArg}`, { cwd }).catch(e => ({ stdout: '' }));
    return { diff: stdout, lines_changed: stdout.split('\n').length, staged, cwd };
  }

  // Stage files (git add)
  if (tool === 'local_git_add') {
    const { directory, files, all = false } = args;
    const cwd = resolvePath(directory || '');
    const target = all ? '-A' : files?.length ? files.map(f => `"${f}"`).join(' ') : '.';
    const { stdout, stderr } = await execAsync(`git add ${target}`, { cwd }).catch(e => { throw new Error(`Git add failed: ${e.message}`); });
    const { stdout: status } = await execAsync('git status --short', { cwd });
    return { success: true, staged: target, status_after: status.trim() };
  }

  // Commit staged changes
  if (tool === 'local_git_commit') {
    const { directory, message, author } = args;
    if (!message) throw new Error('message is required');
    const cwd = resolvePath(directory || '');
    const authorFlag = author ? `--author="${author}" ` : '';
    const { stdout } = await execAsync(`git commit ${authorFlag}-m "${message.replace(/"/g, '\\"')}"`, { cwd }).catch(e => { throw new Error(`Git commit failed: ${e.message}`); });
    return { success: true, output: stdout.trim(), cwd };
  }

  // Push to remote
  if (tool === 'local_git_push') {
    const { directory, remote = 'origin', branch, force = false, set_upstream = false } = args;
    const cwd = resolvePath(directory || '');
    const branchArg = branch ? ` ${branch}` : '';
    const forceFlag = force ? ' --force' : '';
    const upstreamFlag = set_upstream ? ' --set-upstream' : '';
    const { stdout, stderr } = await execAsync(`git push${forceFlag}${upstreamFlag} ${remote}${branchArg}`, { cwd });
    return { success: true, output: (stdout + stderr).trim(), remote, branch: branch || '(current)' };
  }

  // Pull from remote
  if (tool === 'local_git_pull') {
    const { directory, remote = 'origin', branch, rebase = false } = args;
    const cwd = resolvePath(directory || '');
    const rebaseFlag = rebase ? ' --rebase' : '';
    const branchArg = branch ? ` ${remote} ${branch}` : '';
    const { stdout, stderr } = await execAsync(`git pull${rebaseFlag}${branchArg}`, { cwd });
    return { success: true, output: (stdout + stderr).trim(), cwd };
  }

  // Checkout a branch or restore a file
  if (tool === 'local_git_checkout') {
    const { directory, target, file } = args;
    if (!target) throw new Error('target (branch name or commit) is required');
    const cwd = resolvePath(directory || '');
    const fileArg = file ? `-- "${file}"` : '';
    const { stdout, stderr } = await execAsync(`git checkout "${target}" ${fileArg}`, { cwd });
    return { success: true, output: (stdout + stderr).trim(), target, cwd };
  }

  // Create a new branch
  if (tool === 'local_git_create_branch') {
    const { directory, branch_name, from, checkout = true } = args;
    if (!branch_name) throw new Error('branch_name is required');
    const cwd = resolvePath(directory || '');
    const fromRef = from ? ` ${from}` : '';
    const checkoutFlag = checkout ? '-b' : '';
    const cmd = checkout ? `git checkout -b "${branch_name}"${fromRef}` : `git branch "${branch_name}"${fromRef}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return { success: true, branch: branch_name, checked_out: checkout, output: (stdout + stderr).trim() };
  }

  // Merge a branch into the current branch
  if (tool === 'local_git_merge') {
    const { directory, branch, no_ff = false, message } = args;
    if (!branch) throw new Error('branch is required');
    const cwd = resolvePath(directory || '');
    const noffFlag = no_ff ? ' --no-ff' : '';
    const msgFlag = message ? ` -m "${message}"` : '';
    const { stdout, stderr } = await execAsync(`git merge${noffFlag}${msgFlag} "${branch}"`, { cwd });
    return { success: true, merged: branch, output: (stdout + stderr).trim() };
  }

  // Stash working changes
  if (tool === 'local_git_stash') {
    const { directory, message, include_untracked = true } = args;
    const cwd = resolvePath(directory || '');
    const untracked = include_untracked ? ' -u' : '';
    const msgFlag = message ? ` -m "${message}"` : '';
    const { stdout } = await execAsync(`git stash${untracked}${msgFlag}`, { cwd });
    return { success: true, output: stdout.trim(), cwd };
  }

  // Pop the latest stash
  if (tool === 'local_git_stash_pop') {
    const { directory, index = 0 } = args;
    const cwd = resolvePath(directory || '');
    const { stdout, stderr } = await execAsync(`git stash pop stash@{${index}}`, { cwd }).catch(e => ({ stdout: '', stderr: e.message }));
    return { success: !stderr.includes('error'), output: (stdout + stderr).trim(), cwd };
  }

  // Reset HEAD or unstage files
  if (tool === 'local_git_reset') {
    const { directory, mode = 'soft', target = 'HEAD', file } = args;
    const cwd = resolvePath(directory || '');
    const cmd = file ? `git restore --staged "${file}"` : `git reset --${mode} ${target}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd }).catch(e => { throw new Error(`Git reset failed: ${e.message}`); });
    return { success: true, output: (stdout + stderr).trim(), mode, target, cwd };
  }

  // List remotes
  if (tool === 'local_git_remote') {
    const { directory } = args;
    const cwd = resolvePath(directory || '');
    const { stdout } = await execAsync('git remote -v', { cwd }).catch(e => { throw new Error(`Git error: ${e.message}`); });
    const remotes = {};
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [name, url] = line.split(/\s+/);
      remotes[name] = url;
    }
    return { remotes, cwd };
  }

  // Clone a repository
  if (tool === 'local_git_clone') {
    const { url, directory, depth } = args;
    if (!url) throw new Error('url is required');
    const cwd = directory ? resolvePath(directory) : currentWorkspace();
    const depthFlag = depth ? ` --depth ${depth}` : '';
    const { stdout, stderr } = await execAsync(`git clone${depthFlag} "${url}"`, { cwd, timeout: 120000 });
    return { success: true, url, output: (stdout + stderr).trim(), destination: cwd };
  }

  // List or create tags
  if (tool === 'local_git_tag') {
    const { directory, create, message, list = true } = args;
    const cwd = resolvePath(directory || '');
    if (create) {
      const msgFlag = message ? ` -m "${message}"` : '';
      const cmd = message ? `git tag -a "${create}"${msgFlag}` : `git tag "${create}"`;
      const { stdout } = await execAsync(cmd, { cwd });
      return { success: true, tag: create, annotated: !!message };
    }
    const { stdout } = await execAsync('git tag --list --sort=-creatordate', { cwd }).catch(() => ({ stdout: '' }));
    return { tags: stdout.trim().split('\n').filter(Boolean), count: stdout.trim().split('\n').filter(Boolean).length };
  }

  // Show who last modified each line (git blame)
  if (tool === 'local_git_blame') {
    const { directory, file, start_line, end_line } = args;
    if (!file) throw new Error('file is required');
    const cwd = resolvePath(directory || '');
    const lineRange = (start_line && end_line) ? ` -L ${start_line},${end_line}` : '';
    const { stdout } = await execAsync(`git blame --line-porcelain${lineRange} "${file}"`, { cwd }).catch(e => { throw new Error(`Git blame failed: ${e.message}`); });
    // Parse porcelain format into structured output
    const blocks = stdout.split('\n\t');
    const lines = blocks.slice(0, 30).map((block, i) => {
      const headerLines = block.split('\n');
      const commitHash = headerLines[0]?.split(' ')[0];
      const author = headerLines.find(l => l.startsWith('author '))?.replace('author ', '');
      const summary = headerLines.find(l => l.startsWith('summary '))?.replace('summary ', '');
      const content = blocks[i + 1]?.split('\n')[0] || '';
      return { line: start_line ? start_line + i : i + 1, commit: commitHash?.slice(0, 8), author, summary, content };
    });
    return { file, lines: lines.filter(l => l.commit) };
  }

  // ── NPM / NODE ────────────────────────────────────────────────────────────
  // Run an npm script defined in package.json
  if (tool === 'local_npm_run') {
    const { script, directory, args: scriptArgs = [], timeout_ms = 120000 } = args;
    if (!script) throw new Error('script is required (e.g. "build", "test", "dev")');
    const cwd = resolvePath(directory || '');
    const argStr = scriptArgs.length ? ` -- ${scriptArgs.join(' ')}` : '';
    const { stdout, stderr } = await execAsync(`npm run ${script}${argStr}`, { cwd, timeout: timeout_ms, maxBuffer: 10 * 1024 * 1024 }).catch(e => { throw new Error(`npm run ${script} failed: ${e.stderr || e.message}`); });
    return { success: true, script, output: (stdout + stderr).trim(), cwd };
  }

  // Run npm install
  if (tool === 'local_npm_install') {
    const { directory, package: pkg, dev = false, save_exact = false, timeout_ms = 180000 } = args;
    const cwd = resolvePath(directory || '');
    const pkgArg = pkg ? ` ${pkg}` : '';
    const devFlag = dev ? ' --save-dev' : '';
    const exactFlag = save_exact ? ' --save-exact' : '';
    const { stdout, stderr } = await execAsync(`npm install${pkgArg}${devFlag}${exactFlag}`, { cwd, timeout: timeout_ms, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: (stdout + stderr).trim().split('\n').slice(-5).join('\n'), cwd };
  }

  // List installed packages at top level
  if (tool === 'local_npm_list') {
    const { directory, depth = 0, dev = false } = args;
    const cwd = resolvePath(directory || '');
    const devFlag = dev ? '' : ' --prod';
    const { stdout } = await execAsync(`npm list --depth=${depth}${devFlag} --json 2>/dev/null`, { cwd }).catch(() => execAsync(`npm list --depth=${depth}`, { cwd }));
    try {
      const data = JSON.parse(stdout);
      return { name: data.name, version: data.version, packages: Object.keys(data.dependencies || {}), count: Object.keys(data.dependencies || {}).length };
    } catch {
      return { output: stdout.trim() };
    }
  }

  // Read and parse package.json
  if (tool === 'local_get_package_json') {
    const { directory } = args;
    const dir = resolvePath(directory || '');
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) throw new Error(`package.json not found in ${dir}`);
    const data = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return {
      path: pkgPath, name: data.name, version: data.version, description: data.description,
      scripts: data.scripts || {}, main: data.main, type: data.type,
      dependencies: Object.keys(data.dependencies || {}),
      devDependencies: Object.keys(data.devDependencies || {}),
      engines: data.engines
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUPER TOOLS — Multi-step local workflows in a single command
  // ══════════════════════════════════════════════════════════════════════════

  // SUPER: Full project snapshot — structure + git + package.json + env keys
  if (tool === 'local_project_overview') {
    const { directory } = args;
    const cwd = resolvePath(directory || '');
    if (!existsSync(cwd)) throw new Error(`Directory not found: ${cwd}`);

    const [gitStatus, gitLog, diskSize] = await Promise.all([
      execAsync('git status --short', { cwd }).catch(() => ({ stdout: '(not a git repo)' })),
      execAsync('git log --oneline -5', { cwd }).catch(() => ({ stdout: '' })),
      execAsync(`du -sh "${cwd}" 2>/dev/null | cut -f1`).catch(() => ({ stdout: 'unknown' }))
    ]);

    // Top-level structure (no node_modules/.git)
    const structure = readdirSync(cwd).filter(e => !e.startsWith('.')).filter(e => e !== 'node_modules').map(e => {
      const full = join(cwd, e);
      const stat = statSync(full);
      return `${stat.isDirectory() ? '📁' : '📄'} ${e}`;
    }).join('\n');

    // package.json if present
    let pkg = null;
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const data = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      pkg = { name: data.name, version: data.version, scripts: Object.keys(data.scripts || {}), deps: Object.keys(data.dependencies || {}).length, devDeps: Object.keys(data.devDependencies || {}).length };
    }

    // .env keys if present
    let envKeys = [];
    const envPath = join(cwd, '.env');
    if (existsSync(envPath)) {
      envKeys = readFileSync(envPath, 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('#') && l.includes('=')).map(l => l.split('=')[0].trim());
    }

    return { directory: cwd, disk_size: diskSize.stdout.trim(), structure, git_status: gitStatus.stdout.trim(), recent_commits: gitLog.stdout.trim(), package_json: pkg, env_keys: envKeys, env_key_count: envKeys.length };
  }

  // SUPER: Stage all + commit + optional push in one command
  if (tool === 'local_git_smart_commit') {
    const { directory, message, push = false, remote = 'origin', add_pattern = '-A' } = args;
    if (!message) throw new Error('message is required');
    const cwd = resolvePath(directory || '');

    const { stdout: statusBefore } = await execAsync('git status --short', { cwd });
    if (!statusBefore.trim()) return { success: true, message: 'Nothing to commit — working tree clean', pushed: false };

    await execAsync(`git add ${add_pattern}`, { cwd });
    const { stdout: commitOut } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });

    let pushOut = null;
    if (push) {
      const { stdout, stderr } = await execAsync(`git push ${remote}`, { cwd });
      pushOut = (stdout + stderr).trim();
    }

    return { success: true, committed: true, commit_output: commitOut.trim(), pushed: push, push_output: pushOut, files_committed: statusBefore.trim().split('\n').length };
  }

  // SUPER: Create a new file from a named template
  if (tool === 'local_scaffold_file') {
    const { path: p, template, variables = {} } = args;
    if (!p) throw new Error('path is required');
    const fullPath = resolvePath(p);
    checkWriteAllowed(fullPath);

    const ext = extname(fullPath).toLowerCase();
    const name = basename(fullPath).replace(ext, '');
    const nameUpper = name.charAt(0).toUpperCase() + name.slice(1);

    const templates = {
      'react-component': `import React from 'react';\n\ninterface ${nameUpper}Props {\n  // props\n}\n\nexport function ${nameUpper}({ ...props }: ${nameUpper}Props) {\n  return (\n    <div>\n      <h1>${nameUpper}</h1>\n    </div>\n  );\n}\n\nexport default ${nameUpper};\n`,
      'api-route': `import { NextRequest, NextResponse } from 'next/server';\n\nexport async function GET(req: NextRequest) {\n  return NextResponse.json({ message: 'OK' });\n}\n\nexport async function POST(req: NextRequest) {\n  const body = await req.json();\n  return NextResponse.json({ data: body });\n}\n`,
      'test': `import { describe, it, expect } from 'vitest';\n\ndescribe('${nameUpper}', () => {\n  it('should work', () => {\n    expect(true).toBe(true);\n  });\n});\n`,
      'prisma-model': `model ${nameUpper} {\n  id        String   @id @default(cuid())\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@map("${name.toLowerCase()}s")\n}\n`,
      'middleware': `import { NextRequest, NextResponse } from 'next/server';\n\nexport function middleware(req: NextRequest) {\n  return NextResponse.next();\n}\n\nexport const config = {\n  matcher: ['/((?!_next|favicon.ico).*)'],\n};\n`,
      'env-example': Object.entries(variables).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    };

    let content = templates[template] || `// ${nameUpper}\n// Created by local_scaffold_file\n\nexport {};\n`;

    // Apply variable substitutions
    for (const [k, v] of Object.entries(variables)) {
      content = content.split(`{{${k}}}`).join(v);
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath, template: template || 'default', bytes_written: Buffer.byteLength(content, 'utf-8') };
  }

  if (tool === 'local_get_memory_usage') {
    return { memory: memoryUsage() };
  }
  if (tool === 'local_get_cpu_usage') {
    return { cpu: await cpuUsage(args.sample_ms) };
  }

  throw new Error(`Unknown local tool: ${tool}`);

  // ── DOCKER ────────────────────────────────────────────────────────────────
  if (tool === 'local_docker_list_containers') {
    const { all = false } = args;
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const out = execSync(`docker ps ${all ? '-a ' : ''}--format '{{json .}}'`, { encoding: 'utf-8', stdio: 'pipe' });
    return out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  if (tool === 'local_docker_start') {
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker start ${args.container}`, { encoding: 'utf-8' }).trim() };
  }
  if (tool === 'local_docker_stop') {
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker stop ${args.container}`, { encoding: 'utf-8' }).trim() };
  }
  if (tool === 'local_docker_restart') {
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker restart ${args.container}`, { encoding: 'utf-8' }).trim() };
  }
  if (tool === 'local_docker_logs') {
    const { container, lines = 50 } = args;
    if (!container) throw new Error('container is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { logs: execSync(`docker logs --tail ${lines} ${container} 2>&1`, { encoding: 'utf-8' }) };
  }
  if (tool === 'local_docker_exec') {
    const { container, command } = args;
    if (!container || !command) throw new Error('container and command are required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker exec ${container} ${command}`, { encoding: 'utf-8' }) };
  }
  if (tool === 'local_docker_list_images') {
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const out = execSync(`docker images --format '{{json .}}'`, { encoding: 'utf-8', stdio: 'pipe' });
    return out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  if (tool === 'local_docker_pull') {
    const { image } = args;
    if (!image) throw new Error('image is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker pull ${image}`, { encoding: 'utf-8' }) };
  }
  if (tool === 'local_docker_compose_up') {
    const { cwd = '.', detach = true, services } = args;
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const svcStr = services?.join(' ') || '';
    return { output: execSync(`docker compose up ${detach ? '-d ' : ''}${svcStr}`, { cwd, encoding: 'utf-8', stdio: 'pipe' }) };
  }
  if (tool === 'local_docker_compose_down') {
    const { cwd = '.', volumes = false } = args;
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    return { output: execSync(`docker compose down ${volumes ? '-v' : ''}`, { cwd, encoding: 'utf-8', stdio: 'pipe' }) };
  }
  if (tool === 'local_docker_compose_logs') {
    const { cwd = '.', service, lines = 50 } = args;
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const svc = service || '';
    return { logs: execSync(`docker compose logs --tail ${lines} ${svc} 2>&1`, { cwd, encoding: 'utf-8' }) };
  }

  // ── PROCESS MANAGEMENT ────────────────────────────────────────────────────
  if (tool === 'local_kill_process') {
    const { pid, signal = 'TERM' } = args;
    if (!pid) throw new Error('pid is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    execSync(`kill -${signal} ${pid}`);
    return { success: true, pid, signal };
  }
  if (tool === 'local_get_process_by_name') {
    const { name } = args;
    if (!name) throw new Error('name is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    try {
      const out = execSync(`pgrep -a -f "${name}"`, { encoding: 'utf-8' });
      return { processes: out.trim().split('\n').filter(Boolean).map(l => { const [pid, ...rest] = l.split(' '); return { pid: parseInt(pid), cmd: rest.join(' ') }; }) };
    } catch { return { processes: [] }; }
  }



  // ── ARCHIVE / ZIP ─────────────────────────────────────────────────────────
  if (tool === 'local_zip_files') {
    const { output_path, files, cwd: workDir = '.' } = args;
    if (!output_path || !files?.length) throw new Error('output_path and files array are required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    execSync(`zip -r "${output_path}" ${files.map(f => `"${f}"`).join(' ')}`, { cwd: workDir, encoding: 'utf-8' });
    return { success: true, output_path, files_zipped: files.length };
  }
  if (tool === 'local_unzip') {
    const { zip_path, output_dir = '.', overwrite = false } = args;
    if (!zip_path) throw new Error('zip_path is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    execSync(`unzip ${overwrite ? '-o ' : ''}"${zip_path}" -d "${output_dir}"`, { encoding: 'utf-8' });
    return { success: true, zip_path, output_dir };
  }
  if (tool === 'local_tar_create') {
    const { output_path, files, compress = true, cwd: workDir = '.' } = args;
    if (!output_path || !files?.length) throw new Error('output_path and files array are required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const flag = compress ? 'czf' : 'cf';
    execSync(`tar -${flag} "${output_path}" ${files.map(f => `"${f}"`).join(' ')}`, { cwd: workDir });
    return { success: true, output_path, compressed: compress };
  }
  if (tool === 'local_tar_extract') {
    const { tar_path, output_dir = '.', strip_components } = args;
    if (!tar_path) throw new Error('tar_path is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    const stripFlag = strip_components ? `--strip-components=${strip_components}` : '';
    execSync(`tar -xf "${tar_path}" -C "${output_dir}" ${stripFlag}`, { encoding: 'utf-8' });
    return { success: true, tar_path, output_dir };
  }

  // ── NETWORK TOOLS ─────────────────────────────────────────────────────────
  if (tool === 'local_ping') {
    const { host, count = 4 } = args;
    if (!host) throw new Error('host is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    try {
      const out = execSync(`ping -c ${count} "${host}" 2>&1`, { encoding: 'utf-8' });
      return { success: true, host, output: out };
    } catch (e) {
      return { success: false, host, output: e.stdout || e.message };
    }
  }
  if (tool === 'local_curl') {
    const { url, method = 'GET', headers: reqHeaders, data, follow_redirects = true, timeout = 30 } = args;
    if (!url) throw new Error('url is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    let cmd = `curl -s -o - -w "\\n%{http_code}" -X ${method}`;
    if (follow_redirects) cmd += ' -L';
    cmd += ` --max-time ${timeout}`;
    if (reqHeaders) Object.entries(reqHeaders).forEach(([k, v]) => cmd += ` -H "${k}: ${v}"`);
    if (data) cmd += ` -d '${JSON.stringify(data)}'`;
    cmd += ` "${url}"`;
    const out = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
    const lines = out.split('\n');
    const statusCode = parseInt(lines[lines.length - 1]);
    const body = lines.slice(0, -1).join('\n');
    return { status_code: statusCode, body: body.length > 5000 ? body.slice(0, 5000) + '...' : body };
  }
  if (tool === 'local_check_ports') {
    const { ports, host = 'localhost' } = args;
    if (!ports?.length) throw new Error('ports array is required');
    const results = [];
    for (const port of ports) {
      const { execSync } = await import('../src/core/sandbox/restricted-host.js');
      try {
        execSync(`nc -z -w2 "${host}" ${port} 2>/dev/null`, { stdio: 'pipe' });
        results.push({ port, open: true });
      } catch {
        results.push({ port, open: false });
      }
    }
    return { host, results };
  }

  // ── SYSTEMD ───────────────────────────────────────────────────────────────
  if (tool === 'local_systemctl_status') {
    const { service } = args;
    if (!service) throw new Error('service is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    try {
      const out = execSync(`systemctl status ${service} 2>&1`, { encoding: 'utf-8' });
      return { service, output: out };
    } catch (e) {
      return { service, output: e.stdout || e.message };
    }
  }
  if (tool === 'local_systemctl_restart') {
    const { service } = args;
    if (!service) throw new Error('service is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    execSync(`sudo systemctl restart ${service}`, { encoding: 'utf-8' });
    return { success: true, service, action: 'restart' };
  }
  if (tool === 'local_systemctl_logs') {
    const { service, lines = 50, since } = args;
    if (!service) throw new Error('service is required');
    const { execSync } = await import('../src/core/sandbox/restricted-host.js');
    let cmd = `journalctl -u ${service} -n ${lines} --no-pager`;
    if (since) cmd += ` --since="${since}"`;
    return { service, logs: execSync(cmd, { encoding: 'utf-8' }) };
  }

  throw new Error(`Unknown Local tool: ${tool}`);
}

export default { execute };
