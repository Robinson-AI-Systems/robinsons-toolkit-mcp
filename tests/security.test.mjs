import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exec, execSync, assertWriteAllowed, sanitizedEnvironment } from '../src/core/sandbox/restricted-host.js';

test('real subprocesses receive only allowlisted environment, including explicit overrides', async () => {
  const source = { PATH: process.env.PATH, STRIPE_SECRET_KEY: 'test-only-stripe',
    GITHUB_TOKEN: 'test-only-github', DATABASE_URL: 'test-only-database',
    NODE_OPTIONS: '--require=/nonexistent-test-module', BASH_ENV: '/nonexistent-test-file',
    HOME: '/test-only-home', CUSTOM_PROVIDER_CREDENTIAL: 'test-only-unknown' };
  assert.deepEqual(sanitizedEnvironment(source), { PATH: process.env.PATH });
  const dir = mkdtempSync(join(tmpdir(), 'rt-env-'));
  try {
    const script = join(dir, 'env.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.env))');
    const command = `"${process.execPath}" "${script}"`;
    for (const output of [execSync(command, { env: source, encoding: 'utf8' }),
      (await promisify(exec)(command, { env: source })).stdout,
      await new Promise((resolve, reject) => exec(command, { env: source },
        (error, stdout) => error ? reject(error) : resolve(stdout)))]) {
      const env = JSON.parse(output);
      for (const key of Object.keys(source).filter(key => key !== 'PATH')) assert.equal(env[key], undefined);
      assert.equal(env.PATH, source.PATH);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write boundaries reject sibling prefixes, traversal, symlinks and dangling symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-boundary-'));
  const root = join(dir, 'workspace');
  const sibling = join(dir, 'workspace-other');
  mkdirSync(root); mkdirSync(sibling);
  try {
    symlinkSync(sibling, join(root, 'escape'));
    symlinkSync(join(sibling, 'missing'), join(root, 'dangling'));
    for (const path of [join(sibling, 'file'), join(root, '../workspace-other/file'),
      join(root, 'escape/new/file'), join(root, 'dangling/file')]) {
      assert.throws(() => assertWriteAllowed(path, [root]));
    }
    assert.equal(assertWriteAllowed(join(root, 'new/sub/file'), [root]), join(root, 'new/sub/file'));
    assert.equal(assertWriteAllowed(join(sibling, 'file'), [root, sibling]), join(sibling, 'file'));
    assert.throws(() => assertWriteAllowed(join(root, 'file'), []));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('local handler enforces boundaries and sanitizes inherited command environment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-local-security-'));
  const root = join(dir, 'workspace'); const outside = join(dir, 'workspace-other');
  mkdirSync(root); mkdirSync(outside);
  const saved = { ...process.env };
  try {
    process.env.WORKSPACE_ROOT = root;
    delete process.env.ALLOWED_WRITE_PATHS;
    process.env.STRIPE_SECRET_KEY = 'test-only-secret-inheritance';
    const { default: local } = await import('../handlers/local.js');
    symlinkSync(outside, join(root, 'escape'));
    await assert.rejects(local.execute('local_write_file', { path: join(outside, 'file'), content: 'bad' }), /Write blocked/);
    await assert.rejects(local.execute('local_write_file', { path: 'escape/file', content: 'bad' }), /Write blocked/);
    writeFileSync(join(outside, 'source'), 'preserve');
    await assert.rejects(local.execute('local_move_file', { source: join(outside, 'source'), destination: 'moved' }), /Write blocked/);
    assert.ok(existsSync(join(outside, 'source')));
    await local.execute('local_write_file', { path: 'nested/file', content: 'allowed' });
    assert.equal(readFileSync(join(root, 'nested/file'), 'utf8'), 'allowed');
    const script = join(root, 'env.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.env))');
    const result = await local.execute('local_run_command', { command: `"${process.execPath}" "${script}"` });
    assert.equal(result.success, true);
    assert.equal(JSON.parse(result.stdout).STRIPE_SECRET_KEY, undefined);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script execution preserves hostile arguments literally and excludes provider credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-script-'));
  const saved = process.env.STRIPE_SECRET_KEY;
  try {
    process.env.STRIPE_SECRET_KEY = 'test-only-script-secret';
    const script = join(dir, 'script with spaces.cjs');
    const marker = join(dir, 'injected');
    writeFileSync(script, 'console.log(JSON.stringify({args:process.argv.slice(2),secret:process.env.STRIPE_SECRET_KEY}))');
    const args = [`$(touch ${marker})`, '`touch injected`', '"; touch injected; #', 'spaces and unicode é', '', '\nsecond line'];
    const { default: local } = await import('../handlers/local.js');
    const result = await local.execute('local_run_script', { script_path: script, interpreter: process.execPath, args, cwd: dir });
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(result.stdout), {args});
    assert.equal(existsSync(marker), false);
    const invalidInterpreter = await local.execute('local_run_script', { script_path: script, interpreter: `node; touch ${marker}; #`, cwd: dir });
    assert.equal(invalidInterpreter.success, false);
    assert.equal(existsSync(marker), false);
    writeFileSync(script, 'console.error("expected failure");process.exit(7)');
    const failed = await local.execute('local_run_script', { script_path: script, interpreter: process.execPath, cwd: dir });
    assert.equal(failed.success, false);
    assert.equal(failed.exitCode, 7);
    assert.match(failed.stderr, /expected failure/);
    await assert.rejects(local.execute('local_run_script', {script_path: script, args:[{}]}), {code:'INVALID_ARGUMENTS'});
  } finally {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved;
    rmSync(dir, {recursive:true,force:true});
  }
});
