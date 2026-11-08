import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_MANIFEST_SCHEMA, EVIDENCE_SCHEMA,
  validateFixtureManifestRecord, validateFixtureOwnerRecord,
  validateFixtureNamespaceRecord, validateEvidenceRecord,
  runFixturePrepareHelper,
} from '../scripts/idea-first-e2e.mjs';

const script = fileURLToPath(new URL('../scripts/idea-first-e2e.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('help is available without starting a service', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /deterministic/);
  assert.match(result.stdout, /installed/);
});

test('publishes explicit ownership and evidence contracts without enabling preparation', () => {
  assert.deepEqual(FIXTURE_MANIFEST_SCHEMA.required, ['version', 'run_id', 'namespace_id', 'namespace_root', 'fixture_root', 'app_data_dir', 'log_dir', 'ticket_home', 'repository_home', 'webview_data_dir', 'webview_cache_dir', 'assets_dir']);
  assert.deepEqual(EVIDENCE_SCHEMA.required, ['schemaVersion', 'runId', 'suite', 'startedAt', 'result', 'artifacts']);
  assert.equal(FIXTURE_MANIFEST_SCHEMA.version, 1);
  assert.equal(EVIDENCE_SCHEMA.schemaVersion, 1);
});

test('strictly validates and round-trips the Rust fixture manifest and marker shapes', () => {
  const root = '/tmp/opencode/run-1';
  const manifest = {
    version: 1, run_id: 'run-1', namespace_id: 'namespace-1',
    namespace_root: '/tmp/opencode', fixture_root: root,
    app_data_dir: `${root}/app-data`, log_dir: `${root}/logs`,
    ticket_home: `${root}/tickets`, repository_home: `${root}/repos`,
    webview_data_dir: `${root}/webview`, webview_cache_dir: `${root}/webview`,
    assets_dir: `${root}/assets`,
  };
  const owner = { version: 1, run_id: 'run-1', namespace_id: 'namespace-1' };
  const namespace = { version: 1, namespace_id: 'namespace-1' };
  for (const [validate, record, context] of [[validateFixtureManifestRecord, manifest], [validateFixtureOwnerRecord, owner, manifest], [validateFixtureNamespaceRecord, namespace, manifest]]) {
    const roundTripped = JSON.parse(JSON.stringify(record));
    assert.deepEqual(validate(roundTripped, context), record);
  }
});

test('requires one shared WebView data/cache profile directory', () => {
  const root = '/tmp/opencode/run-1';
  const manifest = {
    version: 1, run_id: 'run-1', namespace_id: 'namespace-1', namespace_root: '/tmp/opencode',
    fixture_root: root, app_data_dir: `${root}/app-data`, log_dir: `${root}/logs`,
    ticket_home: `${root}/tickets`, repository_home: `${root}/repos`,
    webview_data_dir: `${root}/webview`, webview_cache_dir: `${root}/webview`, assets_dir: `${root}/assets`,
  };
  assert.equal(validateFixtureManifestRecord(manifest), manifest);
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, webview_cache_dir: `${root}/webview-cache` }), /same WebView profile/);
});

test('rejects unsupported versions, unknown or missing fields, mismatched markers, and unsafe manifest paths', () => {
  const root = '/tmp/opencode/run-1';
  const manifest = {
    version: 1, run_id: 'run-1', namespace_id: 'namespace-1', namespace_root: '/tmp/opencode',
    fixture_root: root, app_data_dir: `${root}/app-data`, log_dir: `${root}/logs`,
    ticket_home: `${root}/tickets`, repository_home: `${root}/repos`,
    webview_data_dir: `${root}/webview`, webview_cache_dir: `${root}/webview`, assets_dir: `${root}/assets`,
  };
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, version: 2 }));
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, surprise: true }));
  const missing = { ...manifest }; delete missing.assets_dir;
  assert.throws(() => validateFixtureManifestRecord(missing));
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, fixture_root: '/tmp/other/run' }));
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, app_data_dir: `${root}/../escape` }));
  assert.throws(() => validateFixtureOwnerRecord({ version: 1, run_id: 'different', namespace_id: 'namespace-1' }, manifest));
  assert.throws(() => validateFixtureOwnerRecord({ version: 1, run_id: 'run-1', namespace_id: 'namespace-1', extra: true }));
  assert.throws(() => validateFixtureOwnerRecord({ version: 1, run_id: 'run-1' }));
  assert.throws(() => validateFixtureNamespaceRecord({ version: 1, namespace_id: 'bad/id' }));
  assert.throws(() => validateFixtureNamespaceRecord({ version: 1, namespace_id: 'namespace-1', extra: true }));
  assert.throws(() => validateFixtureNamespaceRecord({ version: 1 }));
});

test('matches Rust UTF-8 identifier bound and rejects oversized serialized fixture records', () => {
  const root = '/tmp/opencode/run-1';
  const manifest = {
    version: 1, run_id: '😀'.repeat(32), namespace_id: 'namespace-1', namespace_root: '/tmp/opencode',
    fixture_root: root, app_data_dir: `${root}/app-data`, log_dir: `${root}/logs`,
    ticket_home: `${root}/tickets`, repository_home: `${root}/repos`,
    webview_data_dir: `${root}/webview`, webview_cache_dir: `${root}/webview`, assets_dir: `${root}/assets`,
  };
  assert.equal(validateFixtureManifestRecord(manifest), manifest);
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, run_id: '😀'.repeat(33) }), /identifier/);
  const hugePath = `/tmp/${'x'.repeat(66_000)}`;
  assert.throws(() => validateFixtureManifestRecord({ ...manifest, namespace_root: hugePath, fixture_root: `${hugePath}/run` }), /too large/);
});

test('validates bounded evidence records and rejects unsafe artifact paths and hashes', () => {
  const evidence = {
    schemaVersion: 1, runId: 'run-1', suite: 'deterministic', startedAt: '2026-11-07T00:00:00.000Z',
    result: 'passed', artifacts: [{ path: 'evidence/result.json', mediaType: 'application/json', sha256: 'a'.repeat(64) }],
  };
  assert.deepEqual(validateEvidenceRecord(JSON.parse(JSON.stringify(evidence))), evidence);
  assert.throws(() => validateEvidenceRecord({ ...evidence, schemaVersion: 2 }));
  assert.throws(() => validateEvidenceRecord({ ...evidence, extra: 1 }));
  const missing = { ...evidence }; delete missing.result;
  assert.throws(() => validateEvidenceRecord(missing));
  assert.throws(() => validateEvidenceRecord({ ...evidence, artifacts: [{ ...evidence.artifacts[0], path: '../outside' }] }));
  assert.throws(() => validateEvidenceRecord({ ...evidence, artifacts: [{ ...evidence.artifacts[0], sha256: 'not-a-hash' }] }));
  assert.throws(() => validateEvidenceRecord({ ...evidence, artifacts: [evidence.artifacts[0], evidence.artifacts[0]] }), /duplicate artifact path/);
});

test('validates operational arguments against an existing isolated root and remains fail-closed', () => {
  const root = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
  for (const args of [
    ['run', '--root', root, '--suite', 'other'],
    ['run', '--root', root, '--suite', 'installed', '--scenario', 'E00'],
    ['run', '--root', root, '--suite', 'installed', '--scenario', 'E13'],
    ['run', '--root', root, '--suite', 'deterministic', '--unknown'],
    ['cleanup', '--root', root, '--root', root],
    ['cleanup', '--root', root, '--retain-evidence', 'yes'],
    ['cleanup', '--retain-evidence', '--root', root, '--retain-evidence'],
    ['verify', '--root', '/tmp'],
    ['verify', '--root', '/tmp/opencode/nonexistent-e2e-root'],
    ['nonsense'],
  ]) {
    const result = run(...args);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /not implemented/);
  }
  for (const args of [
    ['run', '--root', root, '--suite', 'deterministic', '--scenario', 'E01'],
    ['run', '--root', root, '--suite', 'installed', '--scenario', 'E12'],
  ]) {
    const result = run(...args);
    assert.match(result.stderr, /not implemented/);
  }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cleanup accepts retain-evidence as a flag but still fails closed', () => {
  const root = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const result = run('cleanup', '--root', root, '--retain-evidence');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not implemented/);
    assert.deepEqual(readdirSync(root), []);
    const reversed = run('cleanup', '--retain-evidence', '--root', root);
    assert.match(reversed.stderr, /not implemented/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight rejects invalid assets and never claims to prepare valid ones', () => {
  const fixture = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const root = join(fixture, 'root');
    const bin = join(fixture, 'bin');
    const plugin = join(fixture, 'plugin');
    const link = join(fixture, 'link');
    mkdirSync(root);
    mkdirSync(plugin);
    writeFileSync(bin, 'fixture, never executed', { mode: 0o700 });
    symlinkSync(bin, link);
    const args = ['--root', root, '--opencode-bin', bin, '--app-bin', bin, '--adapter-bin', bin, '--plugin-dir', plugin];
    const invalid = [...args];
    invalid[3] = link;
    assert.match(run('prepare', ...invalid).stderr, /--opencode-bin.*no symlink components/);
    assert.match(run('prepare', ...args, '--root', root).stderr, /duplicate/);
    for (let i = 0; i < 2; i++) {
      const result = run('prepare', ...args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exclusive creation and cleanup contract is not implemented/);
      assert.match(result.stderr, /not implemented/);
      assert.deepEqual(readdirSync(root), []);
    }
    assert.deepEqual(readdirSync(fixture).sort(), ['bin', 'link', 'plugin', 'root']);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('preparation rejects nonempty and unowned roots without modifying them', () => {
  const fixture = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const occupied = join(fixture, 'occupied');
    mkdirSync(occupied);
    writeFileSync(join(occupied, 'keep'), 'preserve');
    assert.notEqual(run('prepare', '--root', occupied).status, 0);
    assert.deepEqual(readdirSync(occupied), ['keep']);
    assert.notEqual(run('prepare', '--root', '/tmp').status, 0);
    assert.notEqual(run('run', '--root', fixture, '--suite', 'deterministic').status, 0);
    assert.deepEqual(readdirSync(fixture), ['occupied']);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('empty-root preflight rejects missing inputs without creating fixture data', () => {
  const root = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const result = run('prepare', '--root', root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing.*--opencode-bin/i);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare rejects an asset with a symlinked ancestor before fail-closed handoff', () => {
  const fixture = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const root = join(fixture, 'root'), actual = join(fixture, 'actual');
    mkdirSync(actual);
    const bin = join(actual, 'bin'); writeFileSync(bin, 'not executed', { mode: 0o700 });
    const linked = join(fixture, 'linked'); symlinkSync(actual, linked);
    const args = ['--root', root, '--opencode-bin', join(linked, 'bin'), '--app-bin', bin, '--adapter-bin', bin, '--plugin-dir', actual];
    const result = run('prepare', ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink component/);
    assert.throws(() => readdirSync(root));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('prepare rejects filesystem root as an asset using an existing owned-root fixture', () => {
  const fixture = mkdtempSync('/tmp/opencode/idea-first-runner-test-');
  try {
    const root = join(fixture, 'root');
    const bin = join(fixture, 'bin');
    writeFileSync(bin, 'fixture only', { mode: 0o700 });
    const result = run('prepare', '--root', root, '--opencode-bin', bin, '--app-bin', bin, '--adapter-bin', bin, '--plugin-dir', '/');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /asset path must not be filesystem root/);
    assert.throws(() => readdirSync(root));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('fixture helper adapter fails closed without launching the executable or mutating either root', async () => {
  const base = mkdtempSync('/tmp/opencode/idea-first-helper-');
  try {
    const helper = join(base, 'fixture-prepare');
    const marker = join(base, 'was-launched');
    const root = join(base, 'fixture');
    writeFileSync(helper, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "launched");\n`, { mode: 0o700 });
    await assert.rejects(runFixturePrepareHelper({ helperPath: helper, root }), /execution is disabled/);
    assert.throws(() => readdirSync(root), { code: 'ENOENT' });
    assert.throws(() => readdirSync(marker), { code: 'ENOENT' });

    const existing = join(base, 'existing');
    mkdirSync(existing); writeFileSync(join(existing, 'keep'), 'safe');
    await assert.rejects(runFixturePrepareHelper({ helperPath: helper, root: existing }), /execution is disabled/);
    assert.deepEqual(readdirSync(existing), ['keep']);
    assert.throws(() => readdirSync(marker), { code: 'ENOENT' });
  } finally { rmSync(base, { recursive: true, force: true }); }
});
