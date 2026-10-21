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
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import BrowserView from './src/components/BrowserView';import{useAppStore}from'./src/store/useAppStore';import{useSettingsStore}from'./src/store/useSettingsStore';
const fixtureWindow:any=window;fixtureWindow.appStore=useAppStore;useSettingsStore.getState().setConfig({platforms:Object.fromEntries(Object.entries(useSettingsStore.getState().config.platforms).map(([id,p]:any)=>[id,{...p,enabled:true}])) as any});
const api={current:null};const test:any=window;test.browserRef=api;test.navigation=[];test.collected=[];test.collectDone=[];
createRoot(document.getElementById('root')!).render(<BrowserView apiRef={api} onNavigate={info=>test.navigation.push(info)} onCollectProgress={data=>test.collected.push(data)} onCollectDone={data=>test.collectDone.push(data)}/>);`,
  loader: 'tsx', resolveDir: root }, tsconfig: join(root, 'tsconfig.json'), bundle: true, platform: 'browser',
  format: 'iife', outfile: join(fixture, 'ui.js'), logLevel: 'silent', plugins });
writeFileSync(join(fixture, 'ui.html'), '<meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}webview{display:flex;min-height:400px}</style><div id="root"></div><script src="ui.js"></script>');
const fixtureDocument = url => {
  const u = new URL(url), detail = u.pathname.startsWith('/job_detail/');
  if (detail) return '<html><body><a id="continue" href="https://www.zhipin.com/web/geek/chat?id=fixture-hr&jobId=fixture-job&securityId=fixture-ticket">继续沟通</a></body></html>';
  const query = Boolean(u.search), chat = u.pathname === '/web/geek/chat';
  const wuba = u.hostname === 'gz.58.com';
  if (wuba && ['/quanzhizhaopin/', '/hulianwangtx/', '/npythonkf/'].some(path => u.pathname.startsWith(path))) {
    const card = (id, title, category = '674,413795,413796,413801') => `<li class="job_item"><div class="job_name"><a tracelogext='${JSON.stringify({ new_catepath: category })}' href="https://gz.58.com/tech/${id}x.shtml">天河 | ${title}</a></div><div class="job_salary">150元/天</div><div class="comp_name">合成公司</div></li>`;
    if (u.searchParams.get('key') === 'ads-only') return '<html><body><ul id="list_con">' + card('11111111111111', '普工', '674,413249,413425') + '</ul></body></html>';
    if (u.searchParams.get('key') === 'native-empty') return '<html><body><div class="noData">抱歉，暂时没有符合该条件的职位，请重新修改搜索条件后再搜索、筛选</div><div id="pc_list_rec">' + card('11111111111111', '普工', '674,413249,413425') + '</div></body></html>';
    return '<html><body><ul>' + (u.searchParams.get('key') === 'mixed' ? card('22222222222222', 'Python实习生') : '') +
      '<li class="job_item">暂无相关职位，为您提供以下职位</li>' + card('11111111111111', '服务员') + '</ul></body></html>';
  }
  const wubaBody = wuba ? '<span class="pos_title">Python实习生</span><div class="des">离线58原生两步投递回归，使用合成在线简历及岗位，不会发送实际申请。</div><div class="pos_operate"><a class="applyJobBtn" href="javascript:void(0)">申请职位</a></div>' : '';
  const modal = '<div id="chooseResume"><div class="guide-box"><span class="infoName">Python实习生</span><li class="resume-item"><input type="radio" checked name="resumeGroup" value="synthetic-resume"><label>合成在线简历</label></li><div id="resumeList_delivery" class="btn active delivery-btn">立即申请</div></div></div>';
  return '<html><body>' + wubaBody + '<div id="native-context">' + (query ? 'selected fixture contact' : 'empty fixture pane') + '</div><script>' +
    'window.fixtureContext=' + JSON.stringify({ selected: query, chat, path: u.pathname }) + ';' +
    (wuba ? 'window.checkClicks=0;window.submitClicks=0;document.addEventListener("click",e=>{if(e.target.closest(".applyJobBtn")){window.checkClicks++;document.body.insertAdjacentHTML("beforeend",' + JSON.stringify(modal) + ');}if(e.target.closest("#resumeList_delivery")){window.submitClicks++;document.querySelector(".applyJobBtn").textContent="已申请";document.querySelector("#chooseResume").remove();}});' : '') +
    (query ? "setTimeout(()=>history.replaceState({},'',location.pathname),80);" : '') + '</script></body></html>';
};
const uiCheck = async function () {
  const wait = async (predicate, label) => {
    const end = Date.now() + 10000;
    for (;;) {
      try { if (await predicate()) return; } catch (error) {
        // React can mount the element before Electron attaches its native guest. Keep waiting for that handshake.
        if (!/WebView must be attached to the DOM and the dom-ready event emitted/.test(String(error))) throw error;
      }
      if (Date.now() > end) throw Error(label);
      await new Promise(r => setTimeout(r, 30));
    }
  };
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
    'https://jobs.51job.com/guangzhou/fixture.html?session=fixture',
    'https://gz.58.com/tech/12345678901234x.shtml?session=fixture']) {
    const item = await open(url), canonical = url.split('?')[0];
    await wait(() => item.el.getURL() === canonical, 'platform canonical URL');
    await new Promise(r => setTimeout(r, 300));
    check(await item.el.executeJavaScript('window.fixtureContext.selected'), 'platform URL cleanup retains its original document: ' + new URL(url).hostname);
    check(api.isPreloadReady(item.id), 'platform SPA navigation retains preload: ' + new URL(url).hostname);
    api.closeTab(item.id);
  }
  const wubaUrl = 'https://gz.58.com/tech/12345678901234x.shtml';
  const delivered = await api.platformApply(wubaUrl, 'wuba', { url: wubaUrl, title: 'Python实习生' }, '离线合成文案', { canStart: () => true, onStart: () => {} });
  check(delivered.ok && delivered.stage === 'success', '58 actual host/preload IPC completes native resume selection and final confirmation');
  const nativeCounts = await findActive().executeJavaScript('({checks:window.checkClicks,submits:window.submitClicks})');
  check(nativeCounts.checks === 1 && nativeCounts.submits === 1, '58 native check and online-resume submission each occur once');
  api.closeTab(delivered.tabId);
  for (const key of ['empty', 'mixed', 'ads-only', 'native-empty']) {
    const url = 'https://gz.58.com/' + (key === 'mixed' ? 'npythonkf' : 'hulianwangtx') + '/?key=' + key + '&final=1&fullPath=' + (key === 'mixed' ? '674,413795,413796,413801' : '674,413795');
    const list = await open(url);
    const seq = 'native-58-' + key;
    api.sendInTab(list.id, 'visual-collect', { seq, expectedSearchUrl: url, settleMs: 400, maxJobs: 10, autoScroll: true });
    await wait(() => window.collectDone.some(d => d.seq === seq), '58 explicit native end completes without scrolling recommendations');
    const done = window.collectDone.find(d => d.seq === seq);
    const jobs = window.collected.filter(d => d.seq === seq && d.phase === 'done').map(d => d.job);
    check(done.reason === 'completed' && jobs.length === (key === 'mixed' ? 1 : 0), '58 actual collector completes ' + key + ' native result set');
    check(jobs.every(j => j.jobId === '22222222222222'), '58 actual collection never emits recommended service jobs');
    if (key === 'ads-only') check(window.collected.some(d => d.seq === seq && d.phase === 'list-bottom' && /滚动到列表底部|连续 3 轮/.test(d.status)), 'all-excluded cards still perform the normal bottom check before completing');
    const loads = await window.electron.invoke('jc:fixture-loads');
    check(!loads.some(u => u.includes('/11111111111111x.shtml')), '58 recommendation detail is never fetched');
    api.closeTab(list.id);
  }
  const wrongCategory = await open('https://gz.58.com/quanzhizhaopin/?key=mixed&final=1');
  api.sendInTab(wrongCategory.id, 'visual-collect', { seq: 'wrong-category', expectedSearchUrl: 'https://gz.58.com/hulianwangtx/?key=mixed&final=1', settleMs: 400 });
  await wait(() => window.collectDone.some(d => d.seq === 'wrong-category'), 'wrong native occupation stops before collecting');
  check(window.collectDone.find(d => d.seq === 'wrong-category').reason === 'failed' && !window.collected.some(d => d.seq === 'wrong-category' && d.phase === 'done'), 'redirect to the full recruitment category cannot collect or complete an IT search');
  api.closeTab(wrongCategory.id);
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
  const second = await open('https://www.zhaopin.com/fixture-collection');
  const beforeActivation = (await window.electron.invoke('jc:fixture-loads')).length;
  api.activateTab(id);
  await wait(() => findActive() === el, 'existing BOSS collector tab becomes visible');
  check(api.getActiveTabId()===id, 'activation reports the actual visible BOSS collecting tab');
  api.activateTab(second.id);
  await wait(() => findActive()===second.el, 'platform handoff displays the existing Zhaopin collecting tab');
  check((await window.electron.invoke('jc:fixture-loads')).length===beforeActivation,
    'switching visible collection platforms keeps both native documents and issues no extra requests');
  api.activateTab('removed-tab');
  check(api.getActiveTabId()===second.id, 'an obsolete tab ID cannot hide the active collecting page');
  api.closeTab(second.id);
  const selector = document.querySelector('[aria-label="新标签页平台"]').closest('.ant-select');
  selector.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await wait(() => document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="58同城"]'), 'new-tab platform dropdown');
  document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="58同城"]').click();
  await wait(() => window.appStore.getState().browserNewTabPlatform === 'wuba', 'new-tab platform persisted from actual control');
  window.appStore.getState().setCollectionPlatforms(['liepin']);
  document.querySelector('button[aria-label="新标签页"]').click();
  await wait(() => findActive()?.getURL().startsWith('https://www.58.com/'), 'plus opens the selected platform');
  check(findActive().getURL().startsWith('https://www.58.com/'), 'new-tab control opens 58 without switching back to BOSS');
  await wait(() => JSON.parse(localStorage.getItem('bossclaw-app') || '{}').state?.browserNewTabPlatform === 'wuba', 'new-tab preference flushed');
  return window.checks;
};
const restartCheck = async function () {
  const until = Date.now() + 10000;
  for (;;) {
    try { if (window.browserRef.current && document.querySelector('.browser-pane.is-active webview')?.getWebContentsId()) break; } catch { /* native guest attachment */ }
    if (Date.now() > until) throw Error('reopened browser guest'); await new Promise(r => setTimeout(r, 30));
  }
  const guest = document.querySelector('.browser-pane.is-active webview');
  while (guest.isLoading() || !guest.getURL()) { if (Date.now() > until) throw Error('restored platform loaded'); await new Promise(r => setTimeout(r, 30)); }
  const selected = document.querySelector('[aria-label="新标签页平台"]').closest('.ant-select').textContent;
  if (!selected.includes('58同城') || !guest.getURL().startsWith('https://www.58.com/')) throw Error('new-tab choice or startup platform reverted after reopen');
  if (JSON.stringify(window.appStore.getState().collectionPlatforms) !== '["liepin"]') throw Error('new-tab preference overwrote independent collection choice');
  return ['reopened BrowserView restores last platform in both dropdown and startup guest, independently of collection'];
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
try{await win.loadFile(${JSON.stringify(join(fixture, 'ui.html'))});const checks=await win.webContents.executeJavaScript('('+${JSON.stringify(uiCheck.toString())}+')()');if(!${prior}){await win.loadFile(${JSON.stringify(join(fixture, 'ui.html'))});checks.push(...await win.webContents.executeJavaScript('('+${JSON.stringify(restartCheck.toString())}+')()'));}fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({checks,loads,platformRequests:0}));}
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
