// Actual React BrowserView + Electron guests. All HTTPS documents are local fixtures.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bossclaw-browser-navigation-'));
const prior = process.argv.includes('--previous-release');
const plugins = prior ? [{ name: 'previous-released-browser', setup(b) {
  b.onLoad({ filter: /[\\/]BrowserView\.tsx$/ }, args => ({ contents: execFileSync('git',
    ['show', 'v2.5.39:desktop-app/src/components/BrowserView.tsx'], { cwd: root, encoding: 'utf8' }), loader: 'tsx', resolveDir: dirname(args.path) }));
} }] : [];
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import BrowserView from './src/components/BrowserView';
const api={current:null};const test:any=window;test.browserRef=api;test.navigation=[];
createRoot(document.getElementById('root')!).render(<BrowserView apiRef={api} onNavigate={info=>test.navigation.push(info)}/>);`,
  loader: 'tsx', resolveDir: root }, tsconfig: join(root, 'tsconfig.json'), bundle: true, platform: 'browser',
  format: 'iife', outfile: join(fixture, 'ui.js'), logLevel: 'silent', plugins });
writeFileSync(join(fixture, 'ui.html'), '<meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}webview{display:flex;min-height:400px}</style><div id="root"></div><script src="ui.js"></script>');
const fixtureDocument = url => {
  const u = new URL(url), detail = u.pathname.startsWith('/job_detail/');
  if (detail) return '<html><body><a id="continue" href="https://www.zhipin.com/web/geek/chat?id=fixture-hr&jobId=fixture-job&securityId=fixture-ticket">继续沟通</a></body></html>';
  const query = Boolean(u.search), chat = u.pathname === '/web/geek/chat';
  return '<html><body><div id="native-context">' + (query ? 'selected fixture contact' : 'empty fixture pane') + '</div><script>' +
    'window.fixtureContext=' + JSON.stringify({ selected: query, chat, path: u.pathname }) + ';' +
    (query ? "setTimeout(()=>history.replaceState({},'',location.pathname),80);" : '') + '</script></body></html>';
};
const uiCheck = async function () {
  const wait = async (predicate, label) => { const end = Date.now() + 10000; while (!await predicate()) {
    if (Date.now() > end) throw Error(label); await new Promise(r => setTimeout(r, 30)); } };
  const check = (condition, label) => { if (!condition) throw Error(label); window.checks.push(label); };
  window.checks = []; await wait(() => window.browserRef.current, 'actual BrowserView API');
  const api = window.browserRef.current, webview = id => document.querySelector('webview[data-fixture-id="' + id + '"]');
  const findActive = () => document.querySelector('.browser-pane.is-active webview');
  const open = async url => {
    const id = api.openInNewTab(url, 'offline fixture', 'detail');
    await wait(() => findActive() && findActive().getURL().startsWith(url.split('?')[0]) && !findActive().isLoading(), 'fixture guest loaded');
    const el = findActive(); el.setAttribute('data-fixture-id', id); await wait(() => api.isPreloadReady(id), 'actual guest preload handshake');
    return { id, el };
  };
  const before = await window.electron.invoke('jc:fixture-loads');
  const boss = await open('https://www.zhipin.com/job_detail/fixture-job.html');
  await boss.el.executeJavaScript("document.getElementById('continue').click()");
  await wait(async () => boss.el.getURL() === 'https://www.zhipin.com/web/geek/chat' &&
    await boss.el.executeJavaScript('window.fixtureContext?.selected===true'), 'BOSS conversation survives its native query cleanup');
  await new Promise(r => setTimeout(r, 700));
  const after = await window.electron.invoke('jc:fixture-loads');
  check(after.filter(u => new URL(u).pathname === '/web/geek/chat').length === before.filter(u => new URL(u).pathname === '/web/geek/chat').length + 1,
    'detail→chat issues one chat document load; URL reports cannot reload it');
  check(await boss.el.executeJavaScript('window.fixtureContext.selected'), 'native selected contact remains attached');
  check(api.isPreloadReady(boss.id), 'replaceState preserves the current preload handshake');
  check(document.querySelector('input[placeholder="输入网址后回车"]')?.value === 'https://www.zhipin.com/web/geek/chat', 'address field displays the observed canonical URL without issuing navigation');
  check(window.navigation.some(n => n.url === 'https://www.zhipin.com/web/geek/chat'), 'observed canonical URL still reaches the host');
  api.closeTab(boss.id);
  for (const url of ['https://www.liepin.com/job/fixture.shtml?session=fixture',
    'https://www.zhaopin.com/jobdetail/CCL0000000000J00000000000.htm?session=fixture',
    'https://jobs.51job.com/guangzhou/fixture.html?session=fixture']) {
    const item = await open(url), canonical = url.split('?')[0];
    await wait(() => item.el.getURL() === canonical, 'platform canonical URL');
    await new Promise(r => setTimeout(r, 300));
    check(await item.el.executeJavaScript('window.fixtureContext.selected'), 'platform URL cleanup retains its original document: ' + new URL(url).hostname);
    check(api.isPreloadReady(item.id), 'platform SPA navigation retains preload: ' + new URL(url).hostname);
    api.closeTab(item.id);
  }
  // Explicit navigation before React mounts a new guest must still use the latest requested URL.
  const first = 'https://www.zhipin.com/before-mount', latest = 'https://www.zhipin.com/requested-before-mount';
  const id = api.openInNewTab(first, 'offline before mount', 'detail'); api.loadURLInTab(id, latest);
  await wait(() => findActive()?.getURL() === latest && !findActive().isLoading(), 'explicit navigation before mount');
  const loads = await window.electron.invoke('jc:fixture-loads');
  check(!loads.includes(first) && loads.filter(u => u === latest).length === 1, 'before-mount request loads its intended URL once');
  const el = findActive();
  api.loadURLInTab(id, 'https://www.zhipin.com/explicit-next');
  await wait(() => el.getURL() === 'https://www.zhipin.com/explicit-next' && !el.isLoading(), 'explicit navigation with existing guest');
  const explicitLoads = await window.electron.invoke('jc:fixture-loads');
  check(explicitLoads.filter(u => u === 'https://www.zhipin.com/explicit-next').length === 1, 'explicit user/API navigation does not receive a second src load');
  return window.checks;
};
const reportPath = join(fixture, 'report.json');
writeFileSync(join(fixture, 'main.cjs'), `const{app,BrowserWindow,session,ipcMain}=require('electron'),fs=require('fs');
app.setPath('userData',${JSON.stringify(join(fixture, 'profile'))});app.setPath('sessionData',${JSON.stringify(join(fixture, 'profile'))});
const loads=[];ipcMain.handle('jc:fixture-loads',()=>loads);app.whenReady().then(async()=>{
const ses=session.fromPartition('persist:bossclaw');ses.protocol.handle('https',request=>{loads.push(request.url);return new Response((${fixtureDocument.toString()})(request.url),{headers:{'Content-Type':'text/html; charset=utf-8'}});});
session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
ses.webRequest.onBeforeRequest({urls:['http://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{webviewTag:true,sandbox:false,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,preload:${JSON.stringify(join(root, 'electron/preload/app.cjs'))}}});
const deadline=setTimeout(()=>{fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:'Actual BrowserView navigation timed out',loads}));app.exit(1);},45000);
try{await win.loadFile(${JSON.stringify(join(fixture, 'ui.html'))});const checks=await win.webContents.executeJavaScript('('+${JSON.stringify(uiCheck.toString())}+')()');fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({checks,loads,platformRequests:0}));}
catch(e){fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:e.stack,loads,checks:await win.webContents.executeJavaScript('window.checks||[]')}));}
finally{clearTimeout(deadline);win.destroy();app.quit();}});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const proc = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [join(fixture, 'main.cjs')], {
  env, windowsHide: true, timeout: 55000, encoding: 'utf8' });
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(proc.status, 0, proc.error?.message || proc.stderr);
if (prior) {
  assert.match(report.error || '', /BOSS conversation survives its native query cleanup/);
  console.log('PASS negative control: released 2.5.39 loses its selected contact after query cleanup; zero platform requests.');
} else {
  assert.ok(!report.error, report.error + '\nCompleted: ' + JSON.stringify(report.checks) + '\nLoads: ' + JSON.stringify(report.loads));
  console.log('PASS actual BrowserView navigation: ' + report.checks.length + ' native guest/React/SPA and explicit navigation checks; zero platform requests.');
}
