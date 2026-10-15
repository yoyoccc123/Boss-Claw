'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const OWNER = 'BossClaw-release-v1';
const SUITES = ['delivery-stop', 'collection-resume', 'collection-goal', 'delivery-throttle',
  'boss-chat', 'browser-navigation', 'zhaopin-greeting', 'resume-facts', 'tailor-iteration', 'resume-variants', 'resume'];
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (parent, target) => {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};
function assertSafeChild(root, target) {
  if (!path.isAbsolute(root) || !path.isAbsolute(target) || !inside(root, target)) throw Error('Cleanup target must be a child of its declared root');
  for (let current = target; inside(root, current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Linked cleanup target is forbidden');
  }
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw Error('Linked cleanup root is forbidden');
  if (fs.existsSync(target) && !inside(fs.realpathSync(root), fs.realpathSync(target))) throw Error('Resolved cleanup target escaped its root');
}
function releaseDirectory(root, version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw Error('Invalid release version');
  return path.join(path.resolve(root), 'releases', version);
}
function removeOwnedDirectory(root, target, kind) {
  assertSafeChild(root, target);
  const marker = JSON.parse(fs.readFileSync(path.join(target, '.bossclaw-owned.json'), 'utf8'));
  if (marker.owner !== OWNER || marker.kind !== kind) throw Error('Directory ownership marker did not match');
  fs.rmSync(target, { recursive: true });
}
function cleanupPreviousReleases(root, current, published, tagExists) {
  if (!published || published.state !== 'published' || published.version !== current || !tagExists(current, published.commit))
    throw Error('Cleanup requires a successful release and its matching source tag');
  const removed = [], releases = path.join(root, 'releases');
  for (const e of fs.existsSync(releases) ? fs.readdirSync(releases, { withFileTypes: true }) : []) {
    if (e.name === current || !e.isDirectory() || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(e.name)) continue;
    const target = path.join(releases, e.name), markerPath = path.join(target, '.bossclaw-owned.json');
    if (!fs.existsSync(markerPath)) continue;
    const old = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (old.owner !== OWNER || old.kind !== 'artifact' || old.version !== e.name || !old.commit || !tagExists(e.name, old.commit)) continue;
    removeOwnedDirectory(root, target, 'artifact'); removed.push(e.name);
  }
  return removed;
}
function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    const file = path.join(root, e.name);
    if (e.isSymbolicLink()) throw Error('Manifest cannot follow a symbolic link');
    return e.isDirectory() ? files(file) : [file];
  });
}
async function sha(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function manifest(root) {
  const list = files(root), results = new Array(list.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => {
    for (;;) { const i = index++; if (i >= list.length) return; const file = list[i];
      results[i] = { relative: path.relative(root, file), size: fs.statSync(file).size, sha256: await sha(file) }; }
  }));
  return results;
}
async function verifyManifest(root, saved) {
  if (files(root).length !== saved.length) throw Error('Data file count changed');
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, saved.length) }, async () => {
    for (;;) { const i = index++; if (i >= saved.length) return; const f = saved[i], current = path.join(root, f.relative);
      if (!inside(root, current) || fs.statSync(current).size !== f.size || await sha(current) !== f.sha256)
        throw Error('Data checksum changed: ' + f.relative); }
  }));
}
module.exports = { OWNER, SUITES, same, inside, assertSafeChild, releaseDirectory, removeOwnedDirectory,
  cleanupPreviousReleases, files, sha, manifest, verifyManifest };
