// Synthetic credentials only. Every Electron launch uses an isolated profile and blocks the network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { authMetadata, createMetadataLog, installSessionPersistence } = require('../electron/session-persistence.cjs');
const base = process.env.BOSSCLAW_TEST_TMP || path.join(process.env.BOSSCLAW_BUILD_ROOT || (process.platform === 'win32' ? 'E:/BossClaw-build' : os.tmpdir()), 'test-tmp');
fs.mkdirSync(base, { recursive: true });
const fixture = fs.mkdtempSync(path.join(base, 'session-persistence-'));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(5); } throw Error('fixture condition timed out'); };
const secret = 'SYNTHETIC_COOKIE_VALUE_MUST_NOT_BE_LOGGED';
const cookie = { name: 'PPU', domain: '.58.com', value: secret, session: false, expirationDate: 2000000000 };
assert.deepEqual(authMetadata(cookie), { platform: 'wuba', name: 'ppu', domain: '58.com', session: false, expires: 2000000000, present: true }); checks++;
for (const domain of ['evil58.com', '58.com.evil.test', 'zhipin.com', '']) check(authMetadata({ ...cookie, domain }) === null, 'reject unrelated authentication domain');
check(authMetadata({ ...cookie, name: 'tracking' }) === null, 'tracking cookie is excluded');
check(authMetadata({ ...cookie, name: 'cloudpassport', domain: '.passport.58.com' })?.name === 'cloudpassport', 'native passport subdomain is included');
for (const [platform, name, domain] of [['boss', 'wt2', '.zhipin.com'], ['liepin', 'lp_token', '.liepin.com'], ['zhaopin', 'at', '.zhaopin.com'], ['zhaopin', 'rt', '.zhaopin.com'], ['job51', 'J_Ticket', '.51job.com']]) {
  check(authMetadata({ ...cookie, name, domain })?.platform === platform, 'observe authentication changes for ' + platform);
  check(authMetadata({ ...cookie, name, domain: domain.slice(1) + '.evil.test' }) === null, 'reject spoofed platform domains for ' + platform);
}

function mock(flushStore = async () => {}) {
  const app = new EventEmitter(); app.exited = 0;
  app.quit = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', event); if (!event.prevented) { app.exited++; app.emit('will-quit'); } };
  const cookies = new EventEmitter(); cookies.get = async () => [cookie]; cookies.flushStore = flushStore;
  const notes = [], storage = { count: 0 }, ses = { cookies, flushStorageData() { storage.count++; } };
  const manager = installSessionPersistence({ app, browserSession: ses, record: e => notes.push(e), flushDelayMs: 5, quitTimeoutMs: 80 });
  return { app, cookies, notes, storage, manager };
}
{
  let release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const m = mock(async () => { writes++; await gate; }); await m.manager.ready;
  m.app.quit(); m.app.quit();
  check(m.app.exited === 0, 'normal close waits for unfinished cookie writes; repeat close remains blocked');
  release(); await wait(() => m.app.exited === 1);
  check(writes === 1 && m.storage.count === 1, 'duplicate quit requests share the same pending write');
  check(m.cookies.listenerCount('changed') === 0, 'remove the persistence listener after exit');
  check(m.notes.some(e => e.phase === 'startup') && m.notes.some(e => e.phase === 'shutdown'), 'capture safe state on both restart boundaries');
  check(!JSON.stringify(m.notes).includes(secret), 'metadata never records authentication values');
}
{
  let release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const m = mock(async () => { if (++writes === 1) await gate; });
  const saving = m.manager.flush();
  m.cookies.emit('changed', {}, cookie, 'inserted', false); await delay(12);
  release(); await saving;
  check(writes === 2, 'a login update arriving during disk write is drained in another write');
  m.app.quit(); await wait(() => m.app.exited === 1);
}
{
  let writes = 0;
  const m = mock(async () => { writes++; });
  for (let i = 0; i < 20; i++) m.cookies.emit('changed', {}, cookie, 'inserted', false);
  await wait(() => writes > 0);
  check(writes === 1, 'coalesce a login cookie burst into one disk write');
  m.cookies.emit('changed', {}, { ...cookie, domain: '58.com.evil.test' }, 'inserted', false);
  await delay(12); check(writes === 1, 'unrelated cookies do not trigger 58 login writes');
  m.cookies.emit('changed', {}, cookie, 'expired', true);
  await wait(() => writes === 2);
  check(m.notes.some(e => e.event === 'auth-change' && e.removed && e.cause === 'expired'), 'record removals without restoring or changing expiry');
  m.app.quit(); await wait(() => m.app.exited === 1);
}
{
  const m = mock(() => new Promise(() => {}));
  m.app.quit(); await wait(() => m.app.exited === 1);
  check(m.notes.some(e => e.event === 'shutdown-save' && e.result === 'timeout'), 'a stalled browser disk write cannot hang application exit');
}
{
  const m = mock(async () => { throw Error(secret); });
  m.app.quit(); await wait(() => m.app.exited === 1);
  check(m.notes.some(e => e.event === 'storage-flush' && e.result === 'failed'), 'a disk failure is diagnosable and does not trap the user in the application');
  check(!JSON.stringify(m.notes).includes(secret), 'errors cannot leak authentication data');
}
{
  const file = path.join(fixture, 'bounded-log.jsonl'), note = createMetadataLog(file);
  for (let i = 0; i < 900; i++) note({ event: 'auth-change', cookie: authMetadata(cookie) });
  const text = fs.readFileSync(file, 'utf8');
  check(fs.statSync(file).size < 129 * 1024, 'diagnostic log remains bounded');
  check(text.trim().split('\n').every(line => JSON.parse(line).cookie.name === 'ppu') && !text.includes(secret), 'retained log lines are valid metadata only');
}

// Verify integration is present in the production ready handler and precedes the user window.
const source = ts.createSourceFile('main.cjs', fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8'), ts.ScriptTarget.Latest, true);
let install, create;
function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.whenReady().then') {
    const body = n.arguments[0]?.body;
    if (body) {
      const scan = child => {
        if (ts.isCallExpression(child) && child.expression.getText(source) === 'installSessionPersistence') install = child;
        if (ts.isCallExpression(child) && child.expression.getText(source) === 'createMainWindow') create = child;
        ts.forEachChild(child, scan);
      }; scan(body);
    }
  }
  ts.forEachChild(n, visit);
} visit(source);
check(install && create && install.pos < create.pos && install.arguments[0].getText(source).includes('browserSession: bossclawSession'), 'production installs persistence before creating its real browser window');

const profile = path.join(fixture, 'profile'), entry = path.join(fixture, 'main.cjs');
const browserExpiry = Math.floor(Date.now() / 1000) + 86400;
fs.writeFileSync(entry, `
const {app,session,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {installSessionPersistence,authMetadata,createMetadataLog}=require(${JSON.stringify(path.join(root, 'electron/session-persistence.cjs'))});
const root=${JSON.stringify(fixture)}, phase=process.argv[2];
app.setName('BossClaw');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
let checks=[],requests=0;const check=(v,label)=>{if(!v)throw Error(label);checks.push(label)};
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify({error:'Electron fixture timeout'}));app.exit(1)},12000);
app.whenReady().then(async()=>{
  const ses=session.fromPartition('persist:bossclaw');
  for(const s of [ses,session.defaultSession])s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>{requests++;cb({cancel:true})});
  const persistence=installSessionPersistence({app,browserSession:ses,otherSessions:[session.defaultSession],record:createMetadataLog(path.join(root,'native-metadata.jsonl'))});
  await persistence.ready;
  const win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,sandbox:true}});
  try{
    const cookies=()=>ses.cookies.get({});const auth=await cookies();
    if(phase==='login-close'){
      check(!auth.some(c=>c.name==='PPU'),'new isolated profile has no real login');
      await ses.cookies.set({url:'https://gz.58.com',name:'PPU',domain:'.58.com',value:${JSON.stringify(secret)},httpOnly:true,secure:true,expirationDate:${browserExpiry}});
      await ses.cookies.set({url:'https://passport.58.com',name:'cloudpassport',domain:'.passport.58.com',value:'synthetic-passport',httpOnly:true,secure:true,expirationDate:${browserExpiry + 1}});
      await ses.cookies.set({url:'https://gz.58.com',name:'session-fixture',value:'temporary'});
      check(Math.abs((await cookies()).find(c=>c.name==='PPU')?.expirationDate-${browserExpiry})<0.001,'login keeps platform expiry unchanged');
    }else if(phase==='restart-logout'){
      check(auth.find(c=>c.name==='PPU')?.value===${JSON.stringify(secret)},'PPU survives immediate normal close and full process restart');
      check(auth.some(c=>c.name==='cloudpassport'&&c.value==='synthetic-passport'),'passport subdomain credential also survives restart');
      check(Math.abs(auth.find(c=>c.name==='PPU').expirationDate-${browserExpiry})<0.001,'restart never extends credential lifetime');
      check(!auth.some(c=>c.name==='session-fixture'),'temporary cookies retain native session lifetime');
      await ses.cookies.remove('https://58.com','PPU');
      await ses.cookies.remove('https://passport.58.com','cloudpassport');
      check(!(await cookies()).some(c=>authMetadata(c)),'explicit logout removes credentials immediately');
    }else{
      check(!auth.some(c=>authMetadata(c)),'logout survives another process restart; credentials are never resurrected');
    }
    fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify({checks,networkRequests:requests}));
  }catch(e){fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify({error:e.message}));process.exitCode=1}
  finally{win.close();app.quit()}
});app.on('will-quit',()=>clearTimeout(deadline));
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.BOSSCLAW_RELEASE_SMOKE_DIR;
for (const phase of ['login-close', 'restart-logout', 'restart-after-logout']) {
  const child = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry, phase], { env, windowsHide: true, timeout: 16000, encoding: 'utf8' });
  const file = path.join(fixture, phase + '.json');
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  assert.equal(child.status, 0, child.error?.message || report.error || child.stderr);
  assert.ok(!report.error, report.error); assert.equal(report.networkRequests, 0);
  checks += report.checks.length + 1;
}
const nativeLog = fs.readFileSync(path.join(fixture, 'native-metadata.jsonl'), 'utf8');
check(!nativeLog.includes(secret) && !nativeLog.includes('synthetic-passport'), 'real Electron diagnostic file contains no credential values');
const nativeEvents = nativeLog.trim().split('\n').map(line => JSON.parse(line));
check(nativeEvents.filter(e => e.event === 'shutdown-save' && e.result === 'finished').length === 3, 'all three native process exits complete the production write barrier');
console.log('PASS session persistence: ' + checks + ' checks including 3 actual Electron launches, login restart, logout, write races, exit timeout and metadata privacy; zero platform requests.');
