// Real Settings inputs, production IPC and persisted policy in an isolated Electron profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = fs.mkdtempSync(path.join(process.env.BOSSCLAW_TEST_TMP || os.tmpdir(), 'bossclaw-browse-settings-'));
const mainSource = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const ast = ts.createSourceFile('main.cjs', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let configureHandler;
function scan(n) {
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'safeHandle' && n.arguments[0]?.text === 'jc:boss-browse') configureHandler = n.arguments[1].getText(ast);
  ts.forEachChild(n, scan);
} scan(ast);
assert.ok(configureHandler, 'production browse IPC handler found');
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import{getTheme}from'./src/theme';import Settings from './src/pages/Settings';import{useSettingsStore}from'./src/store/useSettingsStore';import{useAppStore}from'./src/store/useAppStore';import'./src/index.css';import'./src/index.polish.css';import'antd/dist/reset.css';
const t:any=window;t.settings=useSettingsStore;if(!localStorage.getItem('bossclaw-settings-v2'))useSettingsStore.getState().setConfig({bossBrowseLimit:{windowMinutes:30,maxViews:100}});useAppStore.getState().setSettingsTab('criteria');createRoot(document.getElementById('root')!).render(<ConfigProvider theme={getTheme('light')}><Settings isVisible={false}/></ConfigProvider>);`, resolveDir: root, loader: 'tsx' },
  tsconfig: path.join(root, 'tsconfig.json'), bundle: true, platform: 'browser', format: 'iife', outfile: path.join(fixture, 'ui.js'), logLevel: 'silent' });
fs.writeFileSync(path.join(fixture, 'ui.html'), '<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
fs.writeFileSync(path.join(fixture, 'preload.cjs'), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electron',{bossBrowse:(action,payload)=>ipcRenderer.invoke('jc:boss-browse',action,payload)});contextBridge.exposeInMainWorld('fixture',{events:()=>ipcRenderer.invoke('fixture:events'),failNext:()=>ipcRenderer.invoke('fixture:fail-next')});`);
const runChecks = async function (reloaded) {
  const results = [], check = (v, s) => { if (!v) throw Error(s); results.push(s); };
  const wait = async (fn, label) => { const end = Date.now() + 8000; while (!fn()) { if (Date.now() > end) throw Error(label); await new Promise(r => setTimeout(r, 30)); } };
  const card = () => document.querySelector('[data-testid="boss-browse-limit-settings"]');
  await wait(card, 'actual Settings browse card rendered');
  const minutes = () => document.getElementById('boss-browse-minutes'), views = () => document.getElementById('boss-browse-views');
  const button = () => [...card().querySelectorAll('button')].find(e => e.textContent.includes('应用浏览限额'));
  const policy = () => window.settings.getState().config.bossBrowseLimit;
  const status = () => window.electron.bossBrowse('status');
  const input = async (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 70));
  };
  const clickApply = async () => { button().click(); await new Promise(r => setTimeout(r, 100)); };
  if (reloaded) {
    check(minutes().value === '10' && views().value === '120' && policy().windowMinutes === 10 && policy().maxViews === 120,
      'custom period and quota survive a real renderer reload and Zustand hydration');
    check(card().textContent.includes('当前生效：每 10 分钟最多查看 120 个岗位'), 'reloaded UI shows saved custom policy instead of a fixed 30-minute default');
    check((await status()).maxViews === 120 && (await status()).count === 100, 'native history and effective policy survive renderer reload');
    return results;
  }
  check(document.querySelector('.ant-tabs-tabpane-active .settings-section-card') === card(), 'browse settings are the first card in Settings / job preferences');
  check(minutes().value === '30' && views().value === '100' && button().disabled, 'existing 100/30 user choice is displayed without resetting to defaults');
  await input(minutes(), '');
  check(minutes().value === '' && button().disabled && policy().windowMinutes === 30 && (await status()).windowMinutes === 30,
    'clearing an input preserves an unfinished draft and never applies a transient default');
  await input(minutes(), '45'); await input(views(), '60');
  check(!button().disabled && policy().windowMinutes === 30 && (await status()).maxViews === 100,
    'typing both parameters changes neither running quota nor saved settings before Apply');
  await clickApply();
  await wait(() => policy().windowMinutes === 45 && policy().maxViews === 60, 'atomic settings apply');
  const longer = await status();
  check(!longer.ok && longer.windowMinutes === 45 && longer.maxViews === 60 && longer.count === 100,
    'actual Apply updates both native parameters together while retaining every view');
  check(longer.retryAt === 1792483200000 + 45 * 60000, 'custom longer period replaces the old active wait deadline');
  check(card().textContent.includes('当前生效：每 45 分钟最多查看 60 个岗位') && button().disabled,
    'successful Apply displays the effective policy and clears the dirty draft');
  let events = await window.fixture.events();
  check(events.length === 1 && events[0].previousPolicy.maxViews === 100 && events[0].maxViews === 60,
    'actual main-process event records the previous and new policy exactly once');
  await input(minutes(), '10'); await input(views(), '120'); await clickApply();
  await wait(() => policy().windowMinutes === 10 && policy().maxViews === 120, 'second custom apply');
  check((await status()).ok && (await status()).count === 100, 'a raised quota releases the wait without erasing history');
  await input(minutes(), '11'); await window.fixture.failNext(); await clickApply();
  check(policy().windowMinutes === 10 && (await status()).windowMinutes === 10 && (await status()).error && minutes().value === '11' && !button().disabled,
    'actual budget write failure retains previous UI/native policy, stops admission and preserves the draft');
  events = await window.fixture.events(); check(events.length === 2, 'failed Apply emits no misleading policy change event');
  await wait(() => JSON.parse(localStorage.getItem('bossclaw-settings-v2') || '{}').state?.config?.bossBrowseLimit?.maxViews === 120,
    'custom settings flush to isolated storage');
  check(JSON.parse(localStorage.getItem('bossclaw-settings-v2')).state.config.bossBrowseLimit.windowMinutes === 10,
    'both parameters persist together without the failed draft');
  return results;
};
const report = path.join(fixture, 'report.json'), entry = path.join(fixture, 'main.cjs');
fs.writeFileSync(entry, `const{app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs');
const{createBossBrowseBudget}=require(${JSON.stringify(path.join(root, 'electron/boss-browse-budget.cjs'))});
app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});
let failNext=false;const budgetFile=${JSON.stringify(path.join(fixture, 'budget.json'))};
const budget=createBossBrowseBudget(budgetFile,{clock:()=>1792483200000,write:state=>{if(failNext){failNext=false;throw Error('synthetic disk full');}fs.writeFileSync(budgetFile,JSON.stringify(state));}});budget.configure({maxViews:100,windowMinutes:30});for(let i=0;i<100;i++)budget.reserve();
const getBossBrowseBudget=()=>budget,bossBrowseGuests=new Set(),events=[];let mainWindow;
const productionHandler=${configureHandler};
ipcMain.handle('jc:boss-browse',productionHandler);
ipcMain.handle('fixture:events',()=>events);ipcMain.handle('fixture:fail-next',()=>{failNext=true;});
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,preload:${JSON.stringify(path.join(fixture, 'preload.cjs'))}}});mainWindow=w;
const send=w.webContents.send.bind(w.webContents);w.webContents.send=(channel,state)=>{if(channel==='jc:boss-browse-state')events.push(state);send(channel,state);};
w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
try{await w.loadFile(${JSON.stringify(path.join(fixture, 'ui.html'))});const first=await w.webContents.executeJavaScript('('+${JSON.stringify(runChecks.toString())}+')(false)');await w.loadFile(${JSON.stringify(path.join(fixture, 'ui.html'))});const second=await w.webContents.executeJavaScript('('+${JSON.stringify(runChecks.toString())}+')(true)');fs.writeFileSync(${JSON.stringify(path.join(fixture, 'settings.png'))},(await w.webContents.capturePage()).toPNG());fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({checks:[...first,...second]}));}catch(e){fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack}));}finally{w.destroy();app.quit();}});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env, windowsHide: true, timeout: 45000, encoding: 'utf8' });
assert.equal(result.status, 0, result.error?.message || result.stderr);
const outcome = JSON.parse(fs.readFileSync(report, 'utf8')); assert.ok(!outcome.error, outcome.error);
console.log(`PASS BOSS browse Settings: ${outcome.checks.length} real UI, atomic Apply, native IPC, failure and persistence checks; zero platform requests.`);
