import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { OWNER, SUITES, assertSafeChild, releaseDirectory, cleanupPreviousReleases, manifest, verifyManifest } = createRequire(import.meta.url)('./release-policy.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bossclaw-release-policy-'));
let checks = 0;
const ok = (condition, description) => { assert.ok(condition, description); checks++; };
try {
  for (const target of [root, path.dirname(root), path.join(root, '..', 'userData'), path.join(root, '..', path.basename(root) + '-outside')]) {
    assert.throws(() => assertSafeChild(root, target)); checks++;
  }
  for (const v of ['../userData', '.', '2.5.39/../../', 'C:\\Users', '']) { assert.throws(() => releaseDirectory(root, v)); checks++; }
  const mark = (version, state = 'published', owner = OWNER) => {
    const dir = releaseDirectory(root, version); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.bossclaw-owned.json'), JSON.stringify({ owner, kind: 'artifact', state, version, commit: version }));
    return dir;
  };
  const old = mark('2.5.38'), current = mark('2.5.39'), failed = mark('2.5.37', 'failed'), foreign = mark('2.5.36', 'published', 'other');
  const data = path.join(root, 'userData'); fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'resume.json'), 'original');
  const success = { state: 'published', version: '2.5.39', commit: '2.5.39' };
  assert.throws(() => cleanupPreviousReleases(root, '2.5.39', { ...success, state: 'failed' }, () => true)); checks++;
  assert.throws(() => cleanupPreviousReleases(root, '2.5.39', success, () => false)); checks++;
  ok(fs.existsSync(old), 'failed gates cannot remove the prior release');
  assert.deepEqual(cleanupPreviousReleases(root, '2.5.39', success, (v, commit) => v !== '2.5.37' && v === commit), ['2.5.38']); checks++;
  ok(fs.existsSync(current) && fs.existsSync(failed) && fs.existsSync(foreign), 'retain current, failed diagnostic and unowned directories');
  assert.deepEqual(cleanupPreviousReleases(root, '2.5.39', success, (v, commit) => v === commit), ['2.5.37']); checks++;
  ok(!fs.existsSync(failed), 'a later successful release removes failed artifacts after their source is tagged');
  ok(fs.readFileSync(path.join(data, 'resume.json'), 'utf8') === 'original', 'cleanup never reaches user data');
  const saved = await manifest(data); await verifyManifest(data, saved); checks++;
  fs.writeFileSync(path.join(data, 'resume.json'), 'tampered');
  await assert.rejects(verifyManifest(data, saved)); checks++;
  for (const name of ['delivery-stop', 'collection-resume', 'browser-navigation', 'resume-facts', 'resume-variants']) ok(SUITES.includes(name), 'required release gate ' + name);
  const { resolveRuntimePaths } = createRequire(import.meta.url)('../electron/runtime-paths.cjs');
  const resources = path.join(root, 'installed', 'resources'), userData = path.join(root, 'userData');
  const runtime = resolveRuntimePaths({ packaged: true, appPath: path.join(resources, 'app.asar'), resourcesPath: resources, userData, platform: 'win32' });
  ok(runtime.venv.startsWith(userData + path.sep), 'Python environment survives replacement of the program directory');
  for (const key of ['bridge', 'camoufox', 'appPreload', 'webviewPreload', 'icon', 'python'])
    ok(!runtime[key].includes('app.asar' + path.sep), 'external runtime consumer cannot read inside the archive: ' + key);
  console.log('PASS release policy: ' + checks + ' deletion boundaries, failed-release retention and data-checksum checks.');
} finally { assertSafeChild(path.dirname(root), root); fs.rmSync(root, { recursive: true }); }
