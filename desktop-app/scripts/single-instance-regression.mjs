// No real profiles or websites: exercise native Electron process locking with synthetic platform logins.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import ts from 'typescript';
const require = createRequire(import.meta.url), project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { claimSingleInstance } = require('../electron/single-instance.cjs');
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; };
{
  const app = new EventEmitter(); let quit = 0, windowReads = 0;
  app.requestSingleInstanceLock = () => false; app.quit = () => quit++;
  check(!claimSingleInstance(app, () => { windowReads++; }), 'duplicate launch is denied');
  check(quit === 1 && windowReads === 0 && app.listenerCount('second-instance') === 0, 'duplicate stops before any window or profile work');
}
{
  const app = new EventEmitter(), calls = []; app.requestSingleInstanceLock = () => true;
  let win = null; check(claimSingleInstance(app, () => win), 'first launch acquires ownership');
  app.emit('second-instance'); check(calls.length === 0, 'duplicate during early startup leaves normal initial window creation in charge');
  win = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') };
  app.emit('second-instance'); assert.deepEqual(calls, ['restore', 'show', 'focus']); checks++;
}
const main = ts.createSourceFile('main.cjs', fs.readFileSync(path.join(project, 'electron/main.cjs'), 'utf8'), ts.ScriptTarget.Latest, true);
const guard = main.statements.find(n => ts.isIfStatement(n) && n.expression.getText(main).startsWith('!claimSingleInstance('));
check(guard && guard.thenStatement.getText(main) === 'return;', 'production duplicate guard returns from the main module');
const ready = main.statements.find(n => ts.isExpressionStatement(n) && n.expression.getText(main).startsWith('app.whenReady().then('));
check(guard.end < ready.pos, 'production guard precedes ready/profile initialization');

const base = process.env.BOSSCLAW_TEST_TMP || path.join(process.env.BOSSCLAW_BUILD_ROOT || (process.platform === 'win32' ? 'E:/BossClaw-build' : os.tmpdir()), 'test-tmp');
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'single-instance-')), entry = path.join(root, 'main.cjs');
const seeds = [['boss', 'wt2', 'www.zhipin.com'], ['liepin', 'lp_token', 'www.liepin.com'], ['zhaopin', 'at', 'www.zhaopin.com'], ['zhaopin', 'rt', 'www.zhaopin.com'], ['wuba', 'PPU', 'gz.58.com'], ['job51', 'J_Ticket', 'www.51job.com']];
fs.writeFileSync(entry, `
const{app,session,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const{claimSingleInstance}=require(${JSON.stringify(path.join(project, 'electron/single-instance.cjs'))});
const{installSessionPersistence}=require(${JSON.stringify(path.join(project, 'electron/session-persistence.cjs'))});
const root=${JSON.stringify(root)},role=process.argv[2],seeds=${JSON.stringify(seeds)};
const profile=path.join(root,role==='other-profile'?'other-profile':'profile');
app.setName('BossClaw');app.setPath('userData',profile);app.setPath('sessionData',profile);let win=null,requests=0;
const output=data=>fs.writeFileSync(path.join(root,role+'.json'),JSON.stringify({...data,pid:process.pid,networkRequests:requests}));
if(!claimSingleInstance(app,()=>win)){output({blocked:true,profileOpened:false});return;}
const deadline=setTimeout(()=>{output({error:'native fixture timeout'});app.exit(1)},12000);
app.on('will-quit',()=>clearTimeout(deadline));
app.whenReady().then(async()=>{const ses=session.fromPartition('persist:bossclaw');
 ses.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>{requests++;cb({cancel:true})});
 installSessionPersistence({app,browserSession:ses});
 win=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,session:ses}});
 try{
  if(role==='owner')for(const[platform,name,host]of seeds)await ses.cookies.set({url:'https://'+host,name,value:'SYNTHETIC_ONLY',secure:true,httpOnly:true,expirationDate:Math.floor(Date.now()/1000)+86400});
  await ses.cookies.flushStore();
  const state=async()=>{const all=await ses.cookies.get({});return Object.fromEntries(seeds.map(([platform])=>[platform,seeds.filter(s=>s[0]===platform).every(([,name,host])=>all.some(c=>c.name===name&&c.domain===host&&c.value==='SYNTHETIC_ONLY'))]))};
  output({blocked:false,profileOpened:true,platforms:await state()});
  if(role==='owner'){
   let notifications=0;
   app.on('second-instance',async()=>fs.writeFileSync(path.join(root,'owner-notified.json'),JSON.stringify({notifications:++notifications,platforms:await state()})));
   const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'stop'))){clearInterval(timer);win.close();app.quit()}},40);
  }else{win.close();app.quit()}
 }catch(e){output({error:e.message});win.close();app.quit()}
});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.BOSSCLAW_RELEASE_SMOKE_DIR;
const electron = process.env.BOSSCLAW_ELECTRON || require('electron');
const owner = spawn(electron, [entry, 'owner'], { env, windowsHide: true, stdio: 'ignore' });
const read = name => JSON.parse(fs.readFileSync(path.join(root, name + '.json'), 'utf8'));
const wait = async predicate => { const limit = Date.now() + 14000; while (!predicate()) { if (Date.now() > limit) throw Error('native process fixture timed out'); await new Promise(r => setTimeout(r, 40)); } };
const child = role => {
  const p = spawnSync(electron, [entry, role], { env, windowsHide: true, timeout: 14000, encoding: 'utf8' });
  assert.equal(p.status, 0, p.error?.message || p.stderr); const report = read(role);
  assert.ok(!report.error, report.error); check(report.networkRequests === 0, role + ' never contacts a platform'); return report;
};
try {
  await wait(() => fs.existsSync(path.join(root, 'owner.json')));
  check(Object.values(read('owner').platforms).every(Boolean), 'first native process owns all five synthetic platform logins');
  for (const role of ['duplicate-one', 'duplicate-two']) {
    const result = child(role); check(result.blocked && !result.profileOpened, 'repeat EXE launch exits before opening shared profile');
  }
  await wait(() => fs.existsSync(path.join(root, 'owner-notified.json')) && read('owner-notified').notifications === 2);
  check(Object.values(read('owner-notified').platforms).every(Boolean), 'original process receives both duplicate launches and keeps all logins');
  const other = child('other-profile'); check(!other.blocked && Object.values(other.platforms).every(v => !v), 'isolated test profile can coexist without reading real or primary credentials');
  fs.writeFileSync(path.join(root, 'stop'), 'stop'); await wait(() => owner.exitCode !== null);
  const restarted = child('restart'); check(!restarted.blocked && Object.values(restarted.platforms).every(Boolean), 'normal restart after exit releases ownership and restores all five platform logins');
} finally { fs.writeFileSync(path.join(root, 'stop'), 'stop'); }
console.log('PASS single instance: ' + checks + ' checks including 5 native processes, duplicate launch rejection, profile isolation and five-platform login retention; zero platform requests.');
