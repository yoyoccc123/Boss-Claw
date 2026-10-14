import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { smokePackaged } from './release-smoke.mjs';
const require = createRequire(import.meta.url);
const P = require('./release-policy.cjs');
const project = path.dirname(path.dirname(fileURLToPath(import.meta.url))), repo = path.dirname(project);
const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json')));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const checkOnly = args.includes('--check'), install = args.includes('--install');
const platform = option('--platform', 'win'), target = option('--target', 'dir');
if (!['win', 'mac', 'linux'].includes(platform) || !['dir', 'portable', 'nsis', 'default'].includes(target)) throw Error('Unknown package target');
if (platform !== 'win' && install) throw Error('Fixed-directory deployment supports Windows only');
const buildRoot = path.resolve(process.env.BOSSCLAW_BUILD_ROOT || (process.platform === 'win32' ? 'E:/BossClaw-build' : path.join(repo, '../BossClaw-build')));
if (P.inside(os.tmpdir(), project) || (process.platform === 'win32' && path.parse(buildRoot).root.toLowerCase() !== 'e:\\'))
  throw Error('Release source and build output must live in the fixed E-drive directories');
fs.mkdirSync(buildRoot, { recursive: true });
const logDir = path.join(buildRoot, 'logs', pkg.version); fs.mkdirSync(logDir, { recursive: true });
const log = path.join(logDir, checkOnly ? 'checks.log' : 'release.log');
const fixtures = path.join(buildRoot, 'test-tmp', pkg.version);
fs.mkdirSync(fixtures, { recursive: true });
fs.writeFileSync(path.join(fixtures, '.bossclaw-owned.json'), JSON.stringify({ owner: P.OWNER, kind: 'fixtures' }));
const env = { ...process.env, TEMP: fixtures, TMP: fixtures, BOSSCLAW_BUILD_ROOT: buildRoot, BOSSCLAW_DEBUG: '0', BOSSCLAW_CONTROL: '0',
  ELECTRON_CACHE: path.join(buildRoot, 'cache/electron'), ELECTRON_BUILDER_CACHE: path.join(buildRoot, 'cache/electron-builder'),
  npm_config_cache: path.join(buildRoot, 'cache/npm') };
delete env.ELECTRON_RUN_AS_NODE; delete env.BOSSCLAW_RELEASE_SMOKE_DIR;
const defaultElectron = require('electron');
const electron = env.BOSSCLAW_ELECTRON || defaultElectron;
env.BOSSCLAW_ELECTRON = electron;
const git = (...argv) => execFileSync('git', argv, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const tagExists = (version, commit) => { try { return git('rev-list', '-n', '1', 'v' + version) === commit; } catch { return false; } };
const snapshotTag = (version, commit) => 'bossclaw-source/v' + version + '-' + commit.slice(0, 12);
const sourcePreserved = (version, commit) => {
  if (tagExists(version, commit)) return true;
  try { return git('rev-list', '-n', '1', snapshotTag(version, commit)) === commit; } catch { return false; }
};
let releaseLock;
async function run(executable, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { cwd: project, env: options.env || env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      const text = data.toString(); output += text; fs.appendFileSync(log, text); process.stdout.write(text);
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(Error(path.basename(executable) + ' failed, exit ' + code)));
  });
}
const node = (script, ...argv) => run(process.execPath, [path.join(project, script), ...argv]);
const report = { version: pkg.version, state: 'checking', asar: pkg.build.asar === true, suites: [], userDataTouchedByTests: false };
const reportPath = path.join(logDir, 'release-report.json');
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
try {
  if (!checkOnly) {
    if (git('status', '--porcelain')) throw Error('Commit reviewed source changes before publishing');
    report.commit = git('rev-parse', 'HEAD');
    if (git('tag', '--list', 'v' + pkg.version) && !tagExists(pkg.version, report.commit)) throw Error('Version tag already belongs to different source; increment the version');
  }
  releaseLock = path.join(buildRoot, '.release.lock');
  fs.writeFileSync(releaseLock, JSON.stringify({ pid: process.pid, project }), { flag: 'wx' });
  console.log('校验类型和生产界面');
  await node('node_modules/typescript/bin/tsc', '-b', '--pretty', 'false');
  await node('node_modules/vite/bin/vite.js', 'build');
  console.log('校验发布边界及数据保留策略');
  await node('scripts/release-policy-regression.mjs');
  for (const suite of P.SUITES) {
    console.log('离线回归：' + suite);
    const output = await node('scripts/' + suite + '-regression.mjs');
    report.suites.push({ name: suite, passed: true, summary: output.split(/\r?\n/).filter(s => /^PASS|Failures:|失败/.test(s)) });
    save();
  }
  if (checkOnly) { report.state = 'checked'; save(); console.log('全部固定发布检查通过。'); }
  else {
    const output = P.releaseDirectory(buildRoot, pkg.version);
    if (fs.existsSync(output)) {
      const old = JSON.parse(fs.readFileSync(path.join(output, '.bossclaw-owned.json')));
      if (old.owner !== P.OWNER || old.kind !== 'artifact' || old.version !== pkg.version || old.state === 'published')
        throw Error('Published or unowned release output already exists; increment the version');
      P.removeOwnedDirectory(buildRoot, output, 'artifact');
    }
    fs.mkdirSync(output, { recursive: true });
    const marker = { owner: P.OWNER, kind: 'artifact', version: pkg.version, commit: report.commit, state: 'building' };
    const markerPath = path.join(output, '.bossclaw-owned.json');
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
    const tools = path.join(buildRoot, 'tools'); fs.mkdirSync(tools, { recursive: true });
    const rcedit = path.join(tools, 'rcedit.exe');
    if (platform === 'win' && !fs.existsSync(rcedit)) {
      const candidate = path.join(project, 'node_modules/electron-winstaller/vendor/rcedit.exe');
      if (!fs.existsSync(candidate)) throw Error('Place the verified Windows resource editor in ' + rcedit);
      fs.copyFileSync(candidate, rcedit);
    }
    env.RCEDIT_EXE = rcedit; env.BOSSCLAW_REQUIRE_ICON = '1';
    const config = structuredClone(pkg.build);
    config.electronDist = path.dirname(defaultElectron);
    config.directories.output = output;
    config.extraResources = config.extraResources.map(r => r.to === 'bridge' ? { ...r, from: path.join(buildRoot, 'assets/bridge') } : r);
    const configPath = path.join(logDir, 'electron-builder.json'); fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const builderArgs = ['--' + platform];
    if (target === 'dir') builderArgs.push('--dir'); else if (target !== 'default') builderArgs.push(target);
    await node('node_modules/electron-builder/cli.js', ...builderArgs, '--config', configPath);
    const packaged = path.join(output, 'win-unpacked');
    if (platform === 'win') {
      console.log('验证真实 ASAR 程序和旧文件来源的双简历存储');
      report.smoke = await smokePackaged({ packaged, fixture: path.join(fixtures, 'packaged-smoke'), electron, env, run });
      if (report.smoke.version !== pkg.version) throw Error('Packaged EXE version mismatch');
      const archive = path.join(packaged, 'resources/app.asar'), asar = require('@electron/asar');
      const requiredSources = ['electron/main.cjs', 'electron/preload/webview.cjs', 'electron/preload/boss-chat-context.cjs', 'electron/runtime-paths.cjs',
        ...P.files(path.join(project, 'dist')).map(file => path.relative(project, file))];
      for (const relative of requiredSources) {
        const actual = asar.extractFile(archive, path.normalize(relative));
        if (crypto.createHash('sha256').update(actual).digest('hex') !== await P.sha(path.join(project, relative)))
          throw Error('Packaged source mismatch: ' + relative);
      }
      report.programManifest = await P.manifest(packaged);
      fs.writeFileSync(path.join(logDir, 'program-manifest.json'), JSON.stringify(report.programManifest, null, 2));
      delete report.programManifest;
      if (install) {
        const installPlan = { source: packaged, destination: path.join(repo, '../BossClaw-新版-2.5.15'),
          backupRoot: path.join(repo, '..'), version: pkg.version, sourceCommit: report.commit,
          userData: path.join(process.env.APPDATA, 'BossClaw'), logDir };
        const plan = path.join(logDir, 'install-plan.json'); fs.writeFileSync(plan, JSON.stringify(installPlan, null, 2));
        await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'scripts/install-release.ps1'), '-Plan', plan]);
        report.installation = JSON.parse(fs.readFileSync(path.join(logDir, 'install-result.json'), 'utf8').replace(/^\uFEFF/, ''));
      }
    }
    // Non-Windows artifacts need their own platform smoke before being published.
    if (platform !== 'win') {
      report.state = marker.state = 'built';
      fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2)); save();
      console.log('构建完成；当前固定发布验收仅支持 Windows，本产物尚未发布。');
      process.exitCode = 0;
    } else {
    if (!git('tag', '--list', 'v' + pkg.version)) git('tag', '-a', 'v' + pkg.version, '-m', 'BossClaw ' + pkg.version + ' verified release');
    if (!tagExists(pkg.version, report.commit)) throw Error('Release tag did not preserve the verified source');
    const sourceTags = [];
    for (const entry of fs.readdirSync(path.join(buildRoot, 'releases'), { withFileTypes: true })) {
      const markerFile = path.join(buildRoot, 'releases', entry.name, '.bossclaw-owned.json');
      if (!entry.isDirectory() || entry.name === pkg.version || !fs.existsSync(markerFile)) continue;
      const old = JSON.parse(fs.readFileSync(markerFile));
      if (old.owner !== P.OWNER || old.kind !== 'artifact' || old.version !== entry.name || !old.commit) continue;
      if (git('rev-parse', old.commit + '^{commit}') !== old.commit) throw Error('Old artifact source commit could not be preserved');
      const name = tagExists(old.version, old.commit) ? 'v' + old.version : snapshotTag(old.version, old.commit);
      if (!sourcePreserved(old.version, old.commit)) git('tag', '-a', name, old.commit, '-m', 'BossClaw source snapshot before artifact cleanup');
      sourceTags.push(name);
    }
    // A remote failure leaves validated artifacts and the rollback program intact.
    await run('git', ['push', '--atomic', 'origin', 'HEAD', 'refs/tags/v' + pkg.version, ...sourceTags.map(t => 'refs/tags/' + t)], { env });
    report.state = marker.state = 'published';
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2)); save();
    report.removedReleases = P.cleanupPreviousReleases(buildRoot, pkg.version, marker, sourcePreserved);
    if (report.installation?.previousProgram && fs.existsSync(report.installation.previousProgram)) {
      const previous = report.installation.previousProgram;
      // User-managed runtime environments and private documents are not build artifacts.
      const privateFiles = P.files(previous).some(f => /[\\/]\.venv[\\/]|[\\/](?:Local Storage|Partitions|userData)[\\/]|[.](?:pdf|docx)$/i.test(f));
      if (!privateFiles) {
        fs.writeFileSync(path.join(previous, '.bossclaw-owned.json'), JSON.stringify({ owner: P.OWNER, kind: 'rollback' }));
        P.removeOwnedDirectory(report.installation.backup, previous, 'rollback');
        report.rollbackProgramRemoved = true;
      } else report.rollbackProgramRemoved = false;
    }
    save();
    console.log('发布成功：' + pkg.version + '；输出 ' + output);
    }
  }
  P.removeOwnedDirectory(buildRoot, fixtures, 'fixtures');
} catch (e) { report.state = 'failed'; report.error = e.message; save(); console.error(e.message); process.exitCode = 1; }
finally {
  if (releaseLock && fs.existsSync(releaseLock)) {
    const lock = JSON.parse(fs.readFileSync(releaseLock));
    if (lock.pid === process.pid) fs.unlinkSync(releaseLock);
  }
}
