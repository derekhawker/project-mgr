#!/usr/bin/env node
// T01 scaffold only. No command launches processes or creates fixture data yet.
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Versioned contracts describe intended records; this scaffold does not write them.
export const FIXTURE_MANIFEST_SCHEMA = Object.freeze({
  version: 1,
  required: Object.freeze(['version', 'run_id', 'namespace_id', 'namespace_root', 'fixture_root', 'app_data_dir', 'log_dir', 'ticket_home', 'repository_home', 'webview_data_dir', 'webview_cache_dir', 'assets_dir']),
  markers: Object.freeze({ owner: Object.freeze(['version', 'run_id', 'namespace_id']), namespace: Object.freeze(['version', 'namespace_id']) }),
  authority: 'record shape is not proof of ownership or provenance',
});
export const EVIDENCE_SCHEMA = Object.freeze({
  schemaVersion: 1,
  required: Object.freeze(['schemaVersion', 'runId', 'suite', 'startedAt', 'result', 'artifacts']),
  result: Object.freeze(['passed', 'failed', 'blocked']),
  artifacts: 'bounded list of relative path, mediaType, SHA-256 records; timestamp and media-type wire conventions remain provisional',
});

const MANIFEST_FIELDS = Object.freeze([
  'version', 'run_id', 'namespace_id', 'namespace_root', 'fixture_root',
  'app_data_dir', 'log_dir', 'ticket_home', 'repository_home',
  'webview_data_dir', 'webview_cache_dir', 'assets_dir',
]);
const OWNER_FIELDS = Object.freeze(['version', 'run_id', 'namespace_id']);
const NAMESPACE_FIELDS = Object.freeze(['version', 'namespace_id']);
const EVIDENCE_FIELDS = Object.freeze(['schemaVersion', 'runId', 'suite', 'startedAt', 'result', 'artifacts']);

function exactRecord(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field)) || keys.some((key) => !fields.includes(key))) {
    throw new Error(`${label} has missing or unknown fields`);
  }
  return value;
}

function validVersion(value, version = 1) {
  return Number.isSafeInteger(value) && value === version;
}

function validFixtureId(value, maxBytes = 128) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function validNamespaceId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && /^[A-Za-z0-9._-]+$/.test(value);
}

function normalizedAbsolutePath(value, label) {
  // Deliberately stricter than Rust Path::components(): JS requires a canonical
  // spelling, while Rust currently accepts some equivalent separator spellings.
  if (typeof value !== 'string' || !value || !isAbsolute(value) || resolve(value) !== value) {
    throw new Error(`${label} must be absolute and normalized`);
  }
  return value;
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function enforceRecordSize(value, label) {
  // This is canonical JSON size after parsing, not the original input byte count;
  // callers do not provide raw JSON bytes, so source whitespace cannot be bounded.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 65_536) throw new Error(`${label} is too large`);
}

// These validators accept already-parsed objects. Duplicate keys in original JSON
// cannot be detected here. Structure does not establish file identity, marker
// provenance, lock ownership, or authority to mutate/clean any path.
export function validateFixtureManifestRecord(value) {
  exactRecord(value, MANIFEST_FIELDS, 'fixture manifest');
  enforceRecordSize(value, 'fixture manifest');
  if (!validVersion(value.version) || !validFixtureId(value.run_id) || !validNamespaceId(value.namespace_id)) {
    throw new Error('invalid fixture manifest version or identifier');
  }
  const namespaceRoot = normalizedAbsolutePath(value.namespace_root, 'namespace_root');
  const fixtureRoot = normalizedAbsolutePath(value.fixture_root, 'fixture_root');
  if (!isWithin(namespaceRoot, fixtureRoot)) throw new Error('fixture_root must be inside namespace_root');
  if (value.webview_data_dir !== value.webview_cache_dir) throw new Error('webview_data_dir and webview_cache_dir must be the same WebView profile directory');
  const directories = MANIFEST_FIELDS.slice(5).map((field) => [field, normalizedAbsolutePath(value[field], field)]);
  const relativeDirs = [];
  for (const [field, path] of directories) {
    if (!isWithin(fixtureRoot, path) || path === fixtureRoot) throw new Error(`${field} must be beneath fixture_root`);
    if (field === 'webview_cache_dir' && path === value.webview_data_dir) continue;
    const rel = relative(fixtureRoot, path);
    if (relativeDirs.some((prior) => prior === rel || prior.startsWith(`${rel}${sep}`) || rel.startsWith(`${prior}${sep}`))) {
      throw new Error('fixture directories must be distinct and non-overlapping');
    }
    relativeDirs.push(rel);
  }
  return value;
}

export function validateFixtureOwnerRecord(value, manifest) {
  exactRecord(value, OWNER_FIELDS, 'fixture owner marker');
  enforceRecordSize(value, 'fixture owner marker');
  if (!validVersion(value.version) || !validFixtureId(value.run_id) || !validNamespaceId(value.namespace_id)) throw new Error('invalid fixture owner marker');
  if (manifest && (value.run_id !== manifest.run_id || value.namespace_id !== manifest.namespace_id)) throw new Error('fixture owner marker mismatch');
  return value;
}

export function validateFixtureNamespaceRecord(value, manifest) {
  exactRecord(value, NAMESPACE_FIELDS, 'fixture namespace marker');
  enforceRecordSize(value, 'fixture namespace marker');
  if (!validVersion(value.version) || !validNamespaceId(value.namespace_id)) throw new Error('invalid fixture namespace marker');
  if (manifest && value.namespace_id !== manifest.namespace_id) throw new Error('fixture namespace marker mismatch');
  return value;
}

export function validateEvidenceRecord(value) {
  exactRecord(value, EVIDENCE_FIELDS, 'evidence record');
  if (!validVersion(value.schemaVersion) || !validFixtureId(value.runId) || !['deterministic', 'installed'].includes(value.suite) ||
      typeof value.startedAt !== 'string' || value.startedAt.length === 0 || value.startedAt.length > 128 ||
      !['passed', 'failed', 'blocked'].includes(value.result) || !Array.isArray(value.artifacts) || value.artifacts.length > 256 ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024) throw new Error('invalid or oversized evidence record');
  const paths = new Set();
  for (const artifact of value.artifacts) {
    exactRecord(artifact, ['path', 'mediaType', 'sha256'], 'evidence artifact');
    if (typeof artifact.path !== 'string' || !artifact.path || isAbsolute(artifact.path) || artifact.path.includes('\\') ||
        artifact.path.split('/').some((part) => !part || part === '.' || part === '..') ||
        typeof artifact.mediaType !== 'string' || !artifact.mediaType || artifact.mediaType.length > 128 ||
        typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('invalid evidence artifact');
    if (paths.has(artifact.path)) throw new Error('duplicate artifact path');
    paths.add(artifact.path);
  }
  return value;
}

// There is not yet a process boundary that proves helper provenance, pins the
// executable through spawn, constrains its environment/tree, or verifies the
// resulting fixture. Keep this seam inert until those guarantees are implemented.
export async function runFixturePrepareHelper() {
  throw new Error('fixture helper execution is disabled pending process and result verification');
}

const help = `Idea-first evaluation scaffold (not a release runner)

Usage:
  node app/scripts/idea-first-e2e.mjs --help
  node app/scripts/idea-first-e2e.mjs prepare --root <new-root> --opencode-bin <path> --app-bin <path> --adapter-bin <path> --plugin-dir <path>
  node app/scripts/idea-first-e2e.mjs run --root <owned-root> --suite deterministic|installed [--scenario E##]
  node app/scripts/idea-first-e2e.mjs launch-native|verify|cleanup --root <owned-root>

The root must be a new path beneath /tmp/opencode, with existing real parent
directories and no symlink components. Preparation and all operational commands
remain disabled: safe exclusive creation and failure-cleanup authority are not
implemented. Deterministic and installed suites are separate; neither is implemented.
Fixture manifest and marker records follow Rust startup version 1 shapes. The runner
validates structure only: records do not prove ownership or provenance. Evidence
validation is bounded and version 1, but its timestamp/media-type conventions remain
provisional; a separate runner inventory contract is not yet defined.
No service, provider, native application, or cleanup is started by this scaffold.
`;

function validateNewRoot(root) {
  if (!root || !isAbsolute(root) || resolve(root) !== root) throw new Error('root must be an absolute normalized path');
  const base = realpathSync('/tmp/opencode');
  const rel = relative(base, root);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('root must be below /tmp/opencode');
  const components = rel.split(sep);
  let current = base;
  for (const component of components.slice(0, -1)) {
    current = resolve(current, component);
    let info;
    try { info = lstatSync(current); } catch { throw new Error('root parent must already exist'); }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('root components must be real directories');
  }
  try {
    lstatSync(root);
    throw new Error('root must not already exist; an exclusive creation and cleanup contract is not implemented');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Path validation is not ownership validation; commands remain disabled below.
function validateExistingRoot(root) {
  if (!root || !isAbsolute(root) || resolve(root) !== root) throw new Error('root must be an absolute normalized path');
  let base;
  try { base = realpathSync('/tmp/opencode'); } catch { throw new Error('owned root base /tmp/opencode is unavailable'); }
  const rel = relative(base, root);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('root must be below /tmp/opencode');
  let current = base;
  for (const component of rel.split(sep)) {
    current = resolve(current, component);
    let info;
    try { info = lstatSync(current); } catch { throw new Error('owned root must already exist'); }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('root components must be real directories');
  }
}

function validateAssetPath(value, directory, fixtureRoot) {
  if (!value || !isAbsolute(value) || resolve(value) !== value) throw new Error('asset paths must be absolute normalized paths');
  if (value === sep) throw new Error('asset path must not be filesystem root');
  const rootRelativeToAsset = relative(value, fixtureRoot);
  const assetRelativeToRoot = relative(fixtureRoot, value);
  if (rootRelativeToAsset === '' || (!rootRelativeToAsset.startsWith(`..${sep}`) && rootRelativeToAsset !== '..' && !isAbsolute(rootRelativeToAsset)) ||
      assetRelativeToRoot === '' || (!assetRelativeToRoot.startsWith(`..${sep}`) && assetRelativeToRoot !== '..' && !isAbsolute(assetRelativeToRoot))) {
    throw new Error('asset path must not overlap fixture root');
  }
  const components = value.split(sep).filter(Boolean);
  let current = sep;
  for (let i = 0; i < components.length; i++) {
    current = resolve(current, components[i]);
    let info;
    try { info = lstatSync(current); } catch { throw new Error('asset path component does not exist'); }
    if (info.isSymbolicLink()) throw new Error('asset path contains a symlink component');
    if (i < components.length - 1 && !info.isDirectory()) throw new Error('asset path parent must be a directory');
    if (i === components.length - 1 && (directory ? !info.isDirectory() : !info.isFile())) throw new Error(`asset must be a ${directory ? 'directory' : 'file'}`);
  }
}

function validatePrepare(args) {
  const names = ['--root', '--opencode-bin', '--app-bin', '--adapter-bin', '--plugin-dir'];
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!names.includes(name) || options.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('invalid or duplicate prepare option');
    }
    options.set(name, args[i + 1]);
  }
  for (const name of names.slice(1)) {
    const value = options.get(name);
    if (!value) throw new Error(`missing required ${name}`);
    if (!isAbsolute(value) || resolve(value) !== value) throw new Error(`${name} must be an absolute normalized path`);
    try {
      validateAssetPath(value, name === '--plugin-dir', options.get('--root'));
      if (name !== '--plugin-dir') accessSync(value, constants.X_OK);
    } catch (error) {
      throw new Error(`${name} must name an accessible ${name === '--plugin-dir' ? 'directory' : 'executable file'} with no symlink components: ${error.message}`);
    }
  }
  validateNewRoot(options.get('--root'));
}

function validateOperational(args) {
  const command = args[0];
  const options = args.slice(1);
  const allowed = command === 'run' ? ['--root', '--suite', '--scenario'] : command === 'cleanup' ? ['--root', '--retain-evidence'] : ['--root'];
  const values = new Map();
  let retainEvidence = false;
  if (command !== 'run' && !['launch-native', 'verify', 'cleanup'].includes(command)) throw new Error('unknown command');
  for (let i = 0; i < options.length;) {
    const key = options[i];
    if (command === 'cleanup' && key === '--retain-evidence') {
      if (retainEvidence) throw new Error('invalid or duplicate operational option');
      retainEvidence = true;
      i++;
      continue;
    }
    const value = options[i + 1];
    if (!allowed.includes(key) || values.has(key) || !value || value.startsWith('--')) throw new Error('invalid or duplicate operational option');
    values.set(key, value);
    i += 2;
  }
  if (!values.has('--root')) throw new Error('missing required --root');
  validateExistingRoot(values.get('--root'));
  if (command === 'run') {
    if (!['deterministic', 'installed'].includes(values.get('--suite'))) throw new Error('--suite must be deterministic or installed');
    if (values.has('--scenario') && !/^E(?:0[1-9]|1[0-2])$/.test(values.get('--scenario'))) throw new Error('--scenario must be E01 through E12');
  }
}

export function main(args) {
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(help);
} else {
  try {
    if (args[0] === 'prepare') {
      validatePrepare(args.slice(1));
    } else validateOperational(args);
    throw new Error('not implemented: fixture ownership, evidence, and scenarios are not available');
  } catch (error) {
    console.error(`idea-first-e2e: ${error.message}`);
    process.exitCode = 1;
  }
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
