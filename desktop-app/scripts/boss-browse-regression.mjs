// Production budget, native IPC/preload and real runner tests. No recruitment-site requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { createBossBrowseBudget, normalizePolicy } = require('../electron/boss-browse-budget.cjs');
const { readBossPageBlock } = require('../electron/preload/boss-page-block.cjs');
const temp = fs.mkdtempSync(path.join(process.env.BOSSCLAW_TEST_TMP || os.tmpdir(), 'bossclaw-browse-'));
let checks = 0;
const check = (v, message) => { assert.ok(v, message); checks++; };
let now = Date.parse('2026-10-18T22:08:00+08:00');
const file = path.join(temp, 'budget.json'), budget = createBossBrowseBudget(file, { clock: () => now });
check(budget.status().ok && budget.status().maxViews === 30, 'new installs receive an enabled 30/30 budget');
check(budget.reserve().ok, 'first actual view is admitted');
check(!budget.reserve().ok && budget.status().count === 1, 'simultaneous/cross-tab attempts cannot pass the pacing gate');
check(budget.status().retryAt === now + 60_000, 'views are spread over the window rather than burst at its start');
for (let i = 1; i < 30; i++) { now += 60_000; check(budget.reserve().ok, 'spaced view ' + i + ' is admitted'); }
check(budget.status().count === 30 && !budget.reserve().ok, 'the rolling window never admits more than its quota');
let restored = createBossBrowseBudget(file, { clock: () => now });
check(restored.status().count === 30 && !restored.reserve().ok, 'restart preserves all attempts and wait time');
restored.configure({ maxViews: 1, windowMinutes: 60 });
check(restored.status().count === 30 && !restored.reserve().ok, 'changing settings does not erase existing history');
now += 60_000;
check(budget.reserve().ok && budget.status().count === 30, 'expiry is a sliding window, including its exact boundary');
check(normalizePolicy({ maxViews: 0, windowMinutes: -1 }).maxViews === 30, 'invalid/zero values cannot disable limits');
check(normalizePolicy({ maxViews: Infinity, windowMinutes: 99999 }).windowMinutes === 1440, 'bounds reject nonfinite and unbounded settings');
const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
check(Object.keys(saved).sort().join() === 'attempts,lastNow,policy,restriction,version', 'only count metadata is stored, without job content or credentials');
const rollback = createBossBrowseBudget(file, { clock: () => now - 60_000 });
check(!!rollback.status().error && !rollback.reserve().ok, 'clock rollback fails closed');
const brokenFile = path.join(temp, 'broken.json'); fs.writeFileSync(brokenFile, '{');
check(!!createBossBrowseBudget(brokenFile).status().error, 'corrupt data does not silently reset quota');
const writeFailure = createBossBrowseBudget(path.join(temp, 'write-error.json'), { clock: () => now, write: () => { throw Error('full'); } });
check(!writeFailure.reserve().ok && !!writeFailure.status().error, 'failed persistence prevents the side effect');

now = Date.parse('2026-10-18T22:08:39+08:00');
const restrictedUrl = 'https://www.zhipin.com/web/passport/zp/403.html?callbackUrl=%2Fweb%2Fgeek%2Fjobs';
const notice = '访问受限 抱歉，您暂时无法访问此页面 您的账户存在异常行为，已暂时被限制访问！将于 2026-10-19 00:08 恢复正常 请勿频繁提交刷新请求，耐心等待';
const expectedRecovery = Date.parse('2026-10-19T00:08:00+08:00');
check(readBossPageBlock(restrictedUrl, notice, now).until === expectedRecovery, 'captured 403 recovery time is parsed in China timezone');
check(readBossPageBlock(restrictedUrl, notice.replace('2026-10-19 00:08', '<span>2026-10-19 00:08</span>'), now).until === expectedRecovery, 'HTML response markup does not hide recovery time');
check(readBossPageBlock(restrictedUrl, '', now).code === 32, 'generic 403 without a code parameter is a hard stop');
check(!readBossPageBlock('https://www.zhipin.com/job_detail/demo.html', '开发访问受限资源的权限模块', now), 'normal JD text is not confused with the restriction page');
check(!readBossPageBlock('https://example.test/403.html', notice, now), 'unrelated domains cannot impose a BOSS ban');
check(readBossPageBlock('https://www.zhipin.com/web/user/verify-slider', '', now).code === 35, 'CAPTCHA stops without trying to bypass it');
for (const [text, code, minutes] of [['请求过于频繁', 1006, 10], ['账户异常', 36, 60], ['请完成安全验证', 35, 30]]) {
  const signal = readBossPageBlock('https://www.zhipin.com/web/geek/jobs', text, now);
  check(signal.code === code && signal.until === now + minutes * 60000, 'API signal preserves its own code/cooldown: ' + code);
}
const upgrade = createBossBrowseBudget(path.join(temp, 'upgrade.json'), { clock: () => now });
upgrade.observe('https://www.zhipin.com/web/geek/jobs', '请求过于频繁');
upgrade.observe(restrictedUrl, '');
check(upgrade.status().code === 32 && upgrade.status().retryAt === now + 120 * 60000, 'a later real 403 upgrades a shorter existing rate-limit lock');
const blockedBudget = createBossBrowseBudget(path.join(temp, 'blocked.json'), { clock: () => now });
blockedBudget.observe(restrictedUrl, ''); now += 1000;
const early = blockedBudget.status().retryAt; blockedBudget.observe(restrictedUrl, '');
check(blockedBudget.status().retryAt === early, 'repeated probes never extend the fallback lock');
blockedBudget.observe(restrictedUrl, notice);
check(blockedBudget.status().retryAt === expectedRecovery && !blockedBudget.reserve().ok, 'the real recovery timestamp replaces an estimate and blocks admission');
check(createBossBrowseBudget(path.join(temp, 'blocked.json'), { clock: () => now }).status().blocked, 'platform restriction survives restart independently of settings');
blockedBudget.configure({ maxViews: 1000, windowMinutes: 1 });
check(!blockedBudget.reserve().ok, 'loosening local settings cannot remove a platform restriction');
now = expectedRecovery;
check(!blockedBudget.status().blocked, 'a recorded platform timestamp expires at the stated instant');
check(readBossPageBlock(restrictedUrl, notice, now + 1000).until === expectedRecovery, 'an expired explicit timestamp never invents another two-hour ban');

const nativeSource = fs.readFileSync(path.join(root, 'electron/preload/webview.cjs'), 'utf8');
const ast = ts.createSourceFile('webview.cjs', nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), funcs = new Map();
function visit(n) { if (ts.isFunctionDeclaration(n) && n.name) funcs.set(n.name.text, n.getText(ast)); ts.forEachChild(n, visit); } visit(ast);
async function nativeCase(options = {}) {
  let tick = 100_000, clicks = 0, stopped = false, network = 0, release;
  class Clock extends Date { static now() { return tick; } }
  const b = createBossBrowseBudget(path.join(temp, 'native-' + Math.random() + '.json'), { clock: () => tick });
  const events = [], location = { href: 'https://www.zhipin.com/web/geek/jobs', hostname: 'www.zhipin.com' };
  const c = { Date: Clock, Promise, URL, Math, Set, AbortController, console,
    setTimeout, clearTimeout, readBossPageBlock, bossBlockSignature: '', location,
    document: { body: { innerText: '' }, readyState: 'complete' }, PLATFORM: 'boss', collectCtl: {},
    ADAPTERS: { supportsInlineDetail: () => true },
    collectNotify: (channel, data) => events.push({ channel, data }), notify: () => {},
    ipcRenderer: { invoke: async (_channel, action, payload) => action === 'observe' ? b.observe(location.href, payload.text) : b[action]() },
    waitWhilePaused: async () => {},
    sleep: async ms => {
      tick += ms;
      if (options.stopInWait && events.some(e => e.data.phase === 'browse-wait')) { stopped = true; c.collectCtl.stopped = true; }
      if (options.restartInWait && events.some(e => e.data.phase === 'browse-wait')) c.collectCtl.token = 'new-generation';
    },
    collectCards: () => [card], cardIdentity: () => ({ title: '合成岗位', company: '测试公司' }),
    collectCardKey: () => 'card', smoothScrollIntoView: async () => {}, highlightElement: () => {},
    openCardDetail: async () => { clicks++; }, extractJobDetail: () => ({ jobId: 'synthetic', welfare: ['五险一金'] }),
    ensureCollectStyle: () => {}, loginWallDetected: () => false, all: () => [], $: () => null,
    fetch: async () => { network++; return { ok: false, status: 403, url: restrictedUrl, text: async () => notice }; },
  };
  const card = { id: 'synthetic' };
  vm.createContext(c);
  for (const name of ['bossBrowsePermission', 'reportBossRestriction', 'waitForBossBrowse', 'zpFetch', 'fetchDetailSourceWelfare', 'handleBossApi', 'visualCollect']) vm.runInContext(funcs.get(name), c);
  return { c, b, events, stopped: () => stopped, setStopped: () => { stopped = true; }, clicks: () => clicks, network: () => network, advance: ms => { tick += ms; } };
}
let n = await nativeCase();
await n.c.visualCollect({ seq: 'view', maxJobs: 1, autoScroll: false });
check(n.clicks() === 1 && n.b.status().count === 1, 'actual collector reserves exactly one attempt before opening its card');
check(n.events.some(e => e.data.phase === 'browse-view'), 'actual collector emits counted detail-view metadata');
n = await nativeCase(); n.b.reserve();
await n.c.visualCollect({ seq: 'auto-resume', maxJobs: 1, autoScroll: false });
check(n.events.some(e => e.data.phase === 'browse-wait') && n.clicks() === 1 && n.b.status().count === 2,
  'actual collector waits locally then resumes the same card once, without extra navigation');
n = await nativeCase({ stopInWait: true }); n.b.reserve();
await n.c.visualCollect({ seq: 'stop-budget-wait', maxJobs: 1, autoScroll: false });
check(n.clicks() === 0 && n.b.status().count === 1 && n.events.some(e => e.data.reason === 'stopped'),
  'actual collector Stop during a quota wait preserves the unviewed card');
n = await nativeCase({ restartInWait: true }); n.b.reserve();
await n.c.visualCollect({ seq: 'stale-budget-wait', maxJobs: 1, autoScroll: false });
check(n.clicks() === 0 && n.b.status().count === 1, 'a replaced collector generation cannot reserve or click after its old wait');
n = await nativeCase({ stopInWait: true }); n.b.reserve();
const denied = await n.c.waitForBossBrowse(n.stopped, (phase, state) => n.events.push({ data: { phase, ...state } }));
check(denied.stopped && n.network() === 0 && n.b.status().count === 1, 'Stop during a budget wait performs no later request or extra reservation');
n = await nativeCase();
await n.c.zpFetch('/wapi/zpgeek/job/card.json?encryptJobId=synthetic');
await n.c.fetchDetailSourceWelfare('https://www.zhipin.com/job_detail/synthetic.html', true);
check(n.network() === 1 && n.b.status().blocked, '403 blocks HTML enrichment immediately after the first API response');
const blockedApi = await n.c.handleBossApi('joblist', {});
check(blockedApi.code === 32 && n.network() === 1, 'platform restriction blocks list/API fallback too');
n = await nativeCase(); n.c.ipcRenderer.invoke = async () => { throw Error('unavailable'); };
await n.c.visualCollect({ seq: 'missing-gate', maxJobs: 1, autoScroll: false });
check(n.clicks() === 0 && n.events.some(e => e.data.reason === 'blocked'), 'a missing quota service cannot fail open');

const mainText = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const mainAst = ts.createSourceFile('main.cjs', mainText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), handlers = new Map();
function scan(node) { if (ts.isCallExpression(node) && node.expression.getText(mainAst) === 'safeHandle' && ts.isStringLiteral(node.arguments[0])) handlers.set(node.arguments[0].text, node.arguments[1].getText(mainAst)); ts.forEachChild(node, scan); } scan(mainAst);
const sender = { id: 1, getURL: () => 'file:///app/index.html' }, guest = { id: 2, getURL: () => 'https://www.zhipin.com/web/geek/jobs' };
now = Date.parse('2026-10-18T22:08:39+08:00');
const shared = createBossBrowseBudget(path.join(temp, 'ipc.json'), { clock: () => now });
const h = { mainWindow: { webContents: sender }, bossBrowseGuests: new Set([2]), URL,
  getBossBrowseBudget: () => shared, observeBossBrowseBlock: (...args) => shared.observe(...args),
  detectPython: async () => { throw Error('must not launch Python'); } };
vm.createContext(h);
vm.runInContext('globalThis.gate = ' + handlers.get('jc:boss-browse') + ';globalThis.cfx = ' + handlers.get('jc:camoufox-call'), h);
check(!h.gate({ sender: guest, senderFrame: { parent: {}, url: guest.getURL() } }, 'reserve').ok, 'iframe cannot debit or reconfigure shared state');
check(!h.gate({ sender: { id: 999 } }, 'configure', { maxViews: 999 }).ok, 'untrusted IPC cannot alter policy');
check(h.gate({ sender }, 'reserve').ok, 'trusted host shares the authoritative budget');
check(!h.gate({ sender: guest, senderFrame: { parent: null, url: guest.getURL() } }, 'reserve').ok, 'different tabs share the same pacing history');
const cfx = await h.cfx({ sender }, 'chat', { platform: 'boss' });
check(cfx.browseLimited && !cfx.sent && shared.status().count === 1, 'Camoufox cannot open another job around an exhausted Electron budget');
check(!(await h.cfx({ sender: guest }, 'chat', { platform: 'boss' })).ok, 'browser-engine invocation requires the host caller');
shared.observe(restrictedUrl, notice);
check((await h.cfx({ sender }, 'search', { platform: 'boss' })).browseLimited, 'restricted Camoufox search is stopped before Python/browser startup');
Object.assign(h, { Date: class extends Date { static now() { return now; } }, AbortSignal,
  detectPython: async () => 'synthetic-python', ensureCamoufoxDeps: async () => ({ python: 'synthetic-python' }),
  checkCamoufoxEngine: async () => true, camoufoxProcess: {}, CAMOUFOX_PORT: 1, CAMOUFOX_TOKEN: 'synthetic' });
for (const [code, minutes] of [[32, 120], [35, 30], [36, 60], [1006, 10], [403, 120]]) {
  const riskBudget = createBossBrowseBudget(path.join(temp, 'risk-' + code + '.json'), { clock: () => now });
  h.getBossBrowseBudget = () => riskBudget; h.observeBossBrowseBlock = (...args) => riskBudget.observe(...args);
  h.fetch = async () => ({ json: async () => ({ ok: false, code }) });
  const result = await h.cfx({ sender }, 'chat', { platform: 'boss' });
  check(riskBudget.status().blocked && riskBudget.status().retryAt === now + minutes * 60000, 'real bridge response persists the correct cooldown: ' + code);
  check(result.code === (code === 403 ? 32 : code), 'real bridge keeps the distinct risk code: ' + code);
}
const exactBudget = createBossBrowseBudget(path.join(temp, 'exact.json'), { clock: () => now });
h.getBossBrowseBudget = () => exactBudget; h.observeBossBrowseBlock = (...args) => exactBudget.observe(...args);
h.fetch = async () => ({ json: async () => ({ code: 1006, retryAt: now + 17 * 60000 }) });
check((await h.cfx({ sender }, 'chat', { platform: 'boss' })).retryAt === now + 17 * 60000,
  'a real retryAt from the bridge takes precedence over a code default');

const wbText = fs.readFileSync(path.join(root, 'src/pages/Workbench.tsx'), 'utf8');
const wbAst = ts.createSourceFile('Workbench.tsx', wbText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), variables = new Map();
function findVars(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer.getText(wbAst)); ts.forEachChild(node, findVars); } findVars(wbAst);
function installFunction(context, name) {
  const code = ts.transpileModule(`globalThis.${name} = ${variables.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
}
let clockTick = 5000, deliveryRunning = true, policyCalls = 0;
class TestClock extends Date { static now() { return clockTick; } }
const deliveryContext = { Date: TestClock, Math,
  canContinueDelivery: () => deliveryRunning, addLog: () => {}, setApplyStage: () => {}, pauseAssist: () => {},
  sleep: async ms => { clockTick += ms; deliveryRunning = false; },
  electronApi: { bossBrowse: { call: async () => { policyCalls++; return { ok: false, retryAt: clockTick + 60000, message: '本地限额' }; } } },
};
vm.createContext(deliveryContext); installFunction(deliveryContext, 'awaitBossBrowseForDelivery');
check(!await deliveryContext.awaitBossBrowseForDelivery(1) && policyCalls === 1, 'actual delivery wait observes Stop before retry/admission/navigation');
deliveryRunning = true;
deliveryContext.electronApi.bossBrowse.call = async action => { check(action === 'reserve', 'DOM delivery requests an atomic reservation'); return { ok: true, count: 1, maxViews: 30, windowMinutes: 30 }; };
check(await deliveryContext.awaitBossBrowseForDelivery(1), 'DOM detail navigation can proceed only after admission');
let opened = 0;
const candidate = { id: 'one', deliveryGreeting: '合成招呼语', job: { platform: 'boss', title: '合成岗位' } };
Object.assign(deliveryContext, { deliveryEpochRef: { current: 1 },
  useDataStore: { getState: () => ({ pending: [candidate], greetings: [] }) },
  webviewApi: { current: { openInNewTab: () => { opened++; } } },
  claimDelivery: () => { throw Error('No admission: must not claim or open'); },
});
deliveryContext.electronApi.bossBrowse.call = async () => ({ ok: false, blocked: true, message: '平台限制' });
installFunction(deliveryContext, 'deliverBossDom');
await deliveryContext.deliverBossDom(candidate, 'https://www.zhipin.com/job_detail/synthetic.html');
check(opened === 0, 'actual DOM delivery checks admission before opening its detail tab');
const calls = [], timers = [], ref = value => ({ current: value });
const wh = { Date: TestClock, Math, Promise, Number, useCallback: fn => fn,
  collectAwaitingSeqRef: ref(null), collectSequenceRef: ref(0), collectTerminalRef: ref(''), collectDoneResolve: ref(null),
  collectBottomTimerRef: ref(null), collectDeadlineRef: ref(0), collectTimeoutMsRef: ref(0), collectPhaseRef: ref('collecting'),
  visualItemBufRef: ref({}), visualsRafRef: ref(null), visualActiveRef: ref(true), visualTabRef: ref('tab'),
  setVisualItem: () => {}, setVisualPaused: () => {}, setVisualCollecting: () => {}, addLog: () => {}, ingestJob: () => {},
  webviewApi: { current: { sendInTab: (...args) => calls.push(args), hasTab: () => true } },
  requestAnimationFrame: () => 1, clearTimeout: timer => { if (timer) timer.cancelled = true; },
  setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
};
vm.createContext(wh);
for (const name of ['visualCollectInTab', 'handleCollectProgress', 'controlCollect']) installFunction(wh, name);
const collected = wh.visualCollectInTab('tab', {}), originalTimer = timers[0];
const retryAt = clockTick + originalTimer.ms + 60000;
wh.handleCollectProgress({ seq: wh.collectAwaitingSeqRef.current, phase: 'browse-wait', retryAt, status: '本地限额' });
clockTick += originalTimer.ms; originalTimer.fn();
check(!calls.some(x => x[2]?.action === 'stop') && timers.length === 2, 'long quota waiting extends the real host timeout instead of failing the group');
wh.controlCollect('stop'); await collected;
const stoppedCalls = calls.length; timers[1].fn();
check(!wh.visualActiveRef.current && calls.length === stoppedCalls, 'Stop settles the real waiting host and old timeout cannot restart work');
console.log(`PASS BOSS browse budget: ${checks} persistent rolling-window/pacing, Stop, 403 recovery, actual collector/API and native IPC checks; zero platform requests.`);
