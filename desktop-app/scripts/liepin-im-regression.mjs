// Electron 离线真实 DOM 回归；不登录、不联网、不向任何招聘者发送消息。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8');
const A = require(join(root, 'electron/preload/platform-adapters.cjs'));
const IM = require(join(root, 'electron/preload/liepin-im.cjs'));
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const injected = [
  section('function visible(el)', '// 原始文本行'),
  section('const all = (sel', 'async function waitFor'),
  section('const PLATFORM_NORM', '// ===== 智联「继续沟通」入口'),
  section('async function platformApply', '// platform-apply：非 BOSS'),
  `const normLabelText = ${A.normLabelText.toString()};`,
  `const ADAPTERS = {labelHit: ${A.labelHit.toString()}, labelExactHit: ${A.labelExactHit.toString()}, LOGIN_WALL_TEXT_RE: ${A.LOGIN_WALL_TEXT_RE}};`,
  IM.readLiepinImState.toString(), IM.hasNewLiepinConversation.toString(),
  'const PLATFORM = "liepin"; const clickElement = async (el) => el.click();',
  'const waitFor = async (check) => { const until = Date.now()+700; do { const result = check(); if(result) return result; await new Promise(r=>setTimeout(r,20)); } while(Date.now()<until); return null; };',
].join('\n');

const modal = '<div class="im-ui-chat-modal-container"><div class="chat-header">招聘者甲</div><textarea placeholder="请输入消息"></textarea></div>';
const mount = '<div id="im-c-entry" style="width:0;height:0"><textarea style="position:absolute;top:60px;left:20px" placeholder="请输入消息"></textarea></div>';
const append = (html) => `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)});`;
const tests = [
  { name: '普通聊天窗口', click: append(modal), stage: 'success' },
  { name: '首个窗口隐藏，第二个可见', before: append(modal.replace('class="im-ui-chat-modal-container"', 'class="im-ui-chat-modal-container" style="display:none"')), click: append(modal), stage: 'success' },
  { name: '无尺寸挂载点的可见编辑区', click: append(mount), stage: 'success' },
  { name: '开放 shadow root', click: "const root=document.createElement('div');root.id='im-c-entry';document.body.append(root);root.attachShadow({mode:'open'}).innerHTML='<textarea placeholder=请输入消息></textarea>';", stage: 'success' },
  { name: '同源 iframe 编辑区', click: "const root=document.createElement('div');root.id='im-c-entry';document.body.append(root);const frame=document.createElement('iframe');frame.srcdoc='<textarea placeholder=请输入消息></textarea>';root.append(frame);", stage: 'success' },
  { name: '只有我的沟通入口', before: append('<div class="im-ui-basic-entry-title">我的沟通</div>'), stage: 'failed', review: true },
  { name: '隐藏窗口不算成功', click: append(modal.replace('class="im-ui-chat-modal-container"', 'class="im-ui-chat-modal-container" style="display:none"')), stage: 'failed', review: true },
  { name: '透明窗口不算成功', click: append(modal.replace('class="im-ui-chat-modal-container"', 'class="im-ui-chat-modal-container" style="opacity:0"')), stage: 'failed', review: true },
  { name: '页面其他输入区不算会话', before: append('<textarea placeholder="留言"></textarea>'), stage: 'failed', review: true },
  { name: '挂载点内搜索框不算会话', click: append('<div id="im-c-entry"><textarea placeholder="搜索联系人"></textarea></div>'), stage: 'failed', review: true },
  { name: '无提示词的单行搜索框不算会话', click: append('<div id="im-c-entry"><input role="textbox"></div>'), stage: 'failed', review: true },
  { name: '旧会话没有切换', before: append(modal), stage: 'failed', review: true },
  { name: '旧窗口切换目标招聘者', before: append(modal), click: "document.querySelector('.chat-header').textContent='招聘者乙';", stage: 'success' },
  { name: '按钮变为继续聊', click: "document.querySelector('.btn-main').textContent='继续聊';", stage: 'success' },
  { name: '点击前已是继续聊，不重复点击', label: '继续聊', stage: 'skip', clicks: 0 },
  { name: '延迟创建聊天窗口', click: `setTimeout(()=>{${append(modal)}},150);`, stage: 'success' },
  { name: '安全验证优先于聊天成功', click: append(modal + '<div class="ant-modal">请完成安全验证</div>'), stage: 'risk', code: 35 },
  { name: '隐藏 iframe 不算成功', click: "const root=document.createElement('div');root.id='im-c-entry';document.body.append(root);const frame=document.createElement('iframe');frame.style.display='none';frame.srcdoc='<textarea></textarea>';root.append(frame);", stage: 'failed', review: true },
  { name: '不可读取的 iframe 不猜成功', click: "const root=document.createElement('div');root.id='im-c-entry';document.body.append(root);const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.srcdoc='<textarea></textarea>';root.append(frame);", stage: 'failed', review: true },
];
const temp = mkdtempSync(join(tmpdir(), 'bossclaw-liepin-im-test-'));
const entry = join(temp, 'main.cjs');
const reportPath = join(temp, 'report.json');
writeFileSync(entry, `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
app.setName('BossClawLiepinImRegression');
fs.mkdirSync(path.join(__dirname,'profile'),{recursive:true});
app.setPath('userData',path.join(__dirname,'profile'));
app.setPath('sessionData',path.join(__dirname,'profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true}));
 const results=[];
 try {
  for (const test of ${JSON.stringify(tests)}) {
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>textarea{width:200px;height:50px} .im-ui-chat-modal-container{width:300px;padding:10px}</style><a class="btn-main" data-selector="chat-chat">'+(test.label||'聊一聊')+'</a>'));
   const script='(async()=>{let clicked=0;const results=[];const notify=(channel,data)=>{if(channel==="platform-apply-result")results.push(data);};'+${JSON.stringify(injected)}+String.fromCharCode(10)+(test.before||'')+String.fromCharCode(10)+'document.querySelector(".btn-main").addEventListener("click",()=>{clicked++;'+(test.click||'')+'});await platformApply({seq:"test",platform:"liepin"});return {clicked,results};})()';
   results.push({name:test.name,...await win.webContents.executeJavaScript(script)});
   fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify(results));
  }
  fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify(results));
 }catch(error){fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:error.stack}));}
 finally{win.destroy();app.quit();}
});
`);
const electron = process.env.BOSSCLAW_ELECTRON || require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
new vm.Script(readFileSync(entry, 'utf8'), { filename: entry });
const proc = spawnSync(electron, [entry], { env, windowsHide: true, timeout: 40000, encoding: 'utf8' });
assert.equal(proc.status, 0, proc.error?.message || proc.stderr);
const results = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.ok(Array.isArray(results), results.error);
for (let i = 0; i < tests.length; i++) {
  const expected = tests[i], actual = results[i];
  assert.equal(actual.results.length, 1, `${expected.name}: 只能回传一次终态`);
  assert.equal(actual.results[0].stage, expected.stage, `${expected.name}: ${JSON.stringify(actual.results[0])}`);
  assert.equal(actual.clicked, expected.clicks ?? 1, expected.name);
  if (expected.review) assert.equal(actual.results[0].needsReview, true, expected.name);
  if (expected.code) assert.equal(actual.results[0].code, expected.code, expected.name);
}

// 运行真实工作台处理函数：未知结果要释放锁、保留标签、暂停队列；确认成功才计数。
const wb = readFileSync(join(root, 'src/pages/Workbench.tsx'), 'utf8');
const start = wb.indexOf('  const deliverNonBoss = async');
const end = wb.indexOf('  /** 通道 B：', start);
const compiled = await transform(wb.slice(start, end) + '\nglobalThis.deliverNonBoss = deliverNonBoss;', { loader: 'ts' });
for (const response of [{ ok: false, stage: 'failed', needsReview: true, error: '结果未确认', tabId: 'test' }, { ok: true, stage: 'success', tabId: 'test' }]) {
  const calls = { closed: 0, paused: 0, delivered: 0, next: 0, released: 0, statuses: [] };
  const context = vm.createContext({
    claimDelivery: () => true, releaseDelivery: () => calls.released++, setApplyStage: () => {}, addLog: () => {},
    awaitDeliveryGap: async () => {}, platformLabel: () => '猎聘',
    webviewApi: { current: { platformApply: async () => response, closeTab: () => calls.closed++ } },
    useAppStore: { getState: () => ({ autoAssist: true }) },
    handleDelivered: () => calls.delivered++, updatePending: (_id, data) => calls.statuses.push(data.status),
    recomputeStats: () => {}, pauseAssist: () => calls.paused++, requestRunNext: () => calls.next++,
  });
  vm.runInContext(compiled.code, context);
  await context.deliverNonBoss({ id: 'test', job: { platform: 'liepin', title: '测试岗位' } }, 'https://www.liepin.com/job/1.shtml');
  assert.equal(calls.released, 1);
  assert.equal(calls.closed, 0);
  assert.equal(calls.next, 0);
  assert.equal(calls.paused, response.ok ? 0 : 1);
  assert.equal(calls.delivered, response.ok ? 1 : 0);
  if (!response.ok) assert.deepEqual(calls.statuses, ['failed']);
}
console.log(`猎聘 IM 回归通过：${tests.length} 个真实 DOM 场景、2 个工作台结果处理场景。报告：${reportPath}`);
