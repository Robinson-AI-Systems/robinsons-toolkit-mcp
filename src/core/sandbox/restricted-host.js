import { exec as hostExec, execSync as hostExecSync } from 'node:child_process';
import { promisify } from 'node:util';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from 'node:path';

// This limits inherited environment data; it is not OS/process isolation.
const inheritedNames = new Set([
  'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
]);

export function sanitizedEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) =>
    inheritedNames.has(name) && typeof value === 'string'));
}

function optionsWithEnvironment(options = {}) {
  if (typeof options === 'string') options = { encoding: options };
  return { ...options, env: sanitizedEnvironment(options.env ?? process.env) };
}

export function exec(command, options, callback) {
  if (typeof options === 'function') return hostExec(command, optionsWithEnvironment(), options);
  return hostExec(command, optionsWithEnvironment(options), callback);
}

exec[promisify.custom] = (command, options) =>
  promisify(hostExec)(command, optionsWithEnvironment(options));

export function execSync(command, options) {
  return hostExecSync(command, optionsWithEnvironment(options));
}

function canonicalTarget(path) {
  let ancestor = resolve(path);
  const tail = [];
  for (;;) {
    try {
      lstatSync(ancestor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.unshift(basename(ancestor));
      ancestor = parent;
      continue;
    }
    // Resolve outside the catch: dangling symlinks must fail closed.
    return join(realpathSync(ancestor), ...tail);
  }
}

export function assertWriteAllowed(path, roots) {
  const target = canonicalTarget(path);
  const allowed = roots.some(root => {
    const offset = relative(canonicalTarget(root), target);
    return !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`);
  });
  if (!allowed) throw new Error('Write blocked: target is outside configured write roots.');
  return target;
}
