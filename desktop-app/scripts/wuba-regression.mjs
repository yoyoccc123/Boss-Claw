// Official 58 DOM contract captured 2026-10-16. Local fixtures only; zero platform requests/submissions.
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bossclaw-wuba-'));
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; };
const compiled = await build({ stdin: { contents: `export * from './src/lib/bossclaw/platforms';export * from './src/lib/bossclaw/platformUrls';export * from './src/lib/bossclaw/defaults';export * from './src/lib/bossclaw/collectionGoal';export * from './src/lib/bossclaw/browserWhitelist';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const env = { module: { exports: {} }, URL, URLSearchParams, console, Date, process: { env: {} }, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(env); vm.runInContext(compiled.outputFiles[0].text, env); const T = env.module.exports;
check(T.PLATFORM_IDS.includes('wuba') && T.PLATFORM_META.wuba.deliveryKind === 'resume', '58 is a resume platform');
check(T.PLATFORM_META.wuba.homeUrl === 'https://www.58.com/changecity.html?catepath=quanzhizhaopin', '58 entry uses the verified native city picker, never the invalid www recruitment list');
check(!T.DEFAULT_CONFIG.platforms.wuba.enabled && T.DEFAULT_CONFIG.platforms.wuba.pendingTarget === 50, 'upgrade does not silently enable a new account');
check(T.resolvePlatform('https://gz.58.com/tech/12345678901234x.shtml') === 'wuba', '58 subdomain recognition');
check(T.resolvePlatform('https://evil58.com/') !== 'wuba' && T.resolvePlatform('https://58.com.evil.test/') !== 'wuba', 'domain boundary is exact');
check(T.isWhitelistedUrl('https://passport.58.com/login/') && !T.isWhitelistedUrl('https://evil58.com/'), 'native login remains in whitelist');
for (const [city, slug] of Object.entries({ 广州: 'gz', 深圳: 'sz', 中山: 'zs', 惠州: 'huizhou', 佛山: 'fs' })) {
  const u = new URL(T.buildWubaSearchUrl({ city, keyword: 'AI / Python', page: 2 }));
  check(u.hostname === `${slug}.58.com` && u.pathname === '/quanzhizhaopin/pn2/' && u.searchParams.get('key') === 'AI / Python', 'city/keyword/page: ' + city);
}
assert.throws(() => T.buildWubaSearchUrl({ city: '不存在的城市' }), /暂未登记/); checks++;
for (const city of [undefined, '', '全国', '不限', '全部', '不限制']) {
  assert.throws(() => T.buildWubaSearchUrl({ city }), /选择具体城市/, 'nationwide must not produce a broken 58 URL'); checks++;
}
assert.throws(() => T.buildWubaSearchUrl({ city: '广州', criteria: { employmentTypes: ['兼职'] } }), /独立招聘页面/); checks++;
const config = structuredClone(T.DEFAULT_CONFIG), now = Date.now();
config.platforms.wuba.pendingTarget = 2;
const counts = T.seedCollectionCounts([], { wuba: { date: T.collectionDay(now), count: 2 } }, now);
check(T.collectionGoal(config, [], counts, 'wuba', now).reached && !T.collectionGoal(config, [], counts, 'boss', now).reached, '58 daily discovery target is isolated');
const A = require('../electron/preload/platform-adapters.cjs');
check(A.detectPlatform('gz.58.com') === 'wuba' && A.isListPage('wuba', 'https://gz.58.com/quanzhizhaopin/?key=Python'), 'preload list identity');
check(A.jobIdFromUrl('https://gz.58.com/tech/12345678901234x.shtml?tracking=ignored') === '12345678901234', 'posting number is stable without tracking');
check(!A.isListPage('wuba', 'https://callback.58.com/antibot/verifycode') && !A.isDetailPage('wuba', 'https://gz.58.com/zufang/12345678901234x.shtml'), 'verification and housing are not jobs');

// Execute the production host callback, including Stop between native resume selection and final confirmation.
const browserSource = ts.createSourceFile('BrowserView.tsx', readFileSync(join(root, 'src/components/BrowserView.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let hostExpression;
const findHost = n => { if (ts.isVariableDeclaration(n) && n.name.getText(browserSource) === 'platformApply') hostExpression = n.initializer.getText(browserSource); ts.forEachChild(n, findHost); }; findHost(browserSource);
const hostJs = (await transform('globalThis.apply=' + hostExpression, { loader: 'tsx' })).code;
for (const scenario of ['run', 'stopped', 'closed']) {
  const commands = []; let active = true, open = true;
  const host = { useCallback: f => f, aliveRef: { current: true }, seqRef: { current: 0 }, apiResolvers: { current: new Map() },
    openInNewTab: () => '58tab', hasTab: () => open, closeTabById: () => {}, PLATFORM_META: T.PLATFORM_META,
    isPreloadReady: () => true, isLoading: () => false, pageStatus: async () => ({}), sleep: async () => {},
    APPLY_PAGE_READY_MS: 25000, Date, setTimeout, clearTimeout,
    sendInTab: (_tab, channel, args) => {
      commands.push(channel); if (scenario === 'stopped') active = false; if (scenario === 'closed') open = false;
      const f = host.apiResolvers.current.get(args.seq); host.apiResolvers.current.delete(args.seq); f({ stage: 'resume_ready', token: 'bound-token' });
    }, cmdOnce: async (channel, args) => { commands.push(args.phase); assert.equal(args.token, 'bound-token'); return { ok: true, stage: 'success' }; } };
  vm.createContext(host); vm.runInContext(hostJs, host);
  const r = await host.apply('https://gz.58.com/tech/12345678901234x.shtml', 'wuba', {}, '', { canStart: () => active, onStart: () => {} });
  check(scenario === 'run' ? r.ok && commands.includes('confirm') : r.stage === 'cancelled' && !commands.includes('confirm'), 'native final boundary: ' + scenario);
}

const preload = ts.createSourceFile('webview.cjs', readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let step;
const findStep = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'wubaApplyStep') step = n.getText(preload); ts.forEachChild(n, findStep); }; findStep(preload);
const domSource = readFileSync(join(root, 'electron/preload/wuba.cjs'), 'utf8');
const jobUrl = 'https://gz.58.com/tech/12345678901234x.shtml';
const jobHtml = `<style>.hidden{display:none}</style><div class="pos_base_info"><span class="pos_title">Python实习生</span><span class="pos_salary">150元/天</span></div><div class="pos_address">广州-天河</div><div class="comp_baseInfo_title"><a>示例公司</a></div><p class="comp_baseInfo_scale">10-49人</p><div class="pos_description"><div class="des">负责Python接口测试。<br>能处理CSV数据；职位说明中提到安全验证开发不代表当前被拦截。</div></div><div class="pos_operate"><a class="applyJobBtn" href="javascript:void(0)">申请职位</a></div><input type="file"><a>发简历附件</a>`;
const modalHtml = `<div id="chooseResume"><div class="guide-box"><span class="infoName">Python实习生</span><li class="resume-item"><input type="radio" checked name="resumeGroup" value="fixture-resume"><label>58在线简历</label></li><div id="resumeList_delivery" class="btn active delivery-btn">立即申请</div></div></div>`;
const runDom = async function (source, productionStep, jobHtml, modalHtml, jobUrl) {
  const module = { exports: {} }; new Function('module', source)(module); const WUBA = module.exports;
  let wubaPrepared = null, clicks = [], target = jobUrl, done = 'success';
  const location = { get href() { return target; } };
  const notify = () => {}, textOf = e => e?.innerText || e?.textContent || '';
  const waitFor = async fn => { for (let i = 0; i < 4; i++) { const r = fn(); if (r) return r; await new Promise(r => setTimeout(r, 10)); } return null; };
  const clickElement = async el => {
    clicks.push(el.id || el.className);
    if (el.classList.contains('applyJobBtn')) document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (el.id === 'resumeList_delivery' && ['success', 'success-with-guide'].includes(done)) {
      document.querySelector('#chooseResume').remove(); document.querySelector('.applyJobBtn').textContent = '已申请';
      if (done === 'success-with-guide') document.body.insertAdjacentHTML('beforeend', '<div class="guide-box">申请成功，建议完善简历</div>');
    }
  };
  const wubaApplyStep = eval('(' + productionStep + ')');
  const checks = [], check = (c, label) => { if (!c) throw Error(label); checks.push(label); };
  const reset = () => { document.body.innerHTML = jobHtml; clicks = []; target = jobUrl; done = 'success'; wubaPrepared = null; };
  reset(); const extracted = WUBA.extract(document, jobUrl);
  check(extracted.title === 'Python实习生' && extracted.company === '示例公司' && extracted.description.includes('CSV'), 'real detail fields exclude the city breadcrumb');
  check(!WUBA.readPageBlock(document, jobUrl), 'JD mentioning verification is not a challenge');
  check(WUBA.readPageBlock(document, 'https://callback.58.com/antibot/verifycode').kind === 'risk', 'actual 58 verification redirect');
  check(WUBA.readPageBlock(document, 'https://passport.58.com/login/').kind === 'login', 'native login redirect');
  check(WUBA.readPageBlock(document, 'https://404.58.com/404.html?from=www.58.com/quanzhizhaopin/').kind === 'failed', 'native 404 redirect is a failed page, not a recruitment list or login prompt');
  const mismatch = await wubaApplyStep({ job: { url: jobUrl.replace('12345678901234', '99999999999999') } });
  check(!mismatch.ok && clicks.length === 0, 'different posting number cannot submit');
  reset(); document.querySelector('.applyJobBtn').textContent = '已申请';
  check((await wubaApplyStep({ job: { url: jobUrl } })).stage === 'skip' && !clicks.length, 'previous applications do not count as new delivery');
  reset(); document.body.insertAdjacentHTML('beforeend', '<div role="alert">申请成功</div>'); done = 'unknown';
  let ready = await wubaApplyStep({ job: { url: jobUrl } });
  check(ready.stage === 'resume_ready' && clicks.length === 1, 'old success panel cannot count as fresh success; prepare clicks only the job action');
  const unknown = await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token });
  check(!unknown.ok && unknown.needsReview && clicks.length === 2, 'unconfirmed submission is retained for review');
  reset(); ready = await wubaApplyStep({ job: { url: jobUrl } });
  const ok = await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token });
  check(ok.ok && clicks.length === 2 && clicks.every(s => !/file|image|附件/.test(s)), 'two native buttons confirm one application, no attachment action');
  check((await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token })).stage === 'skip' && clicks.length === 2, 'duplicate confirm never resubmits');
  reset(); ready = await wubaApplyStep({ job: { url: jobUrl } }); done = 'success-with-guide';
  check((await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token })).ok && clicks.length === 2, 'native success remains confirmed when optional resume-completion guidance appears');
  reset(); ready = await wubaApplyStep({ job: { url: jobUrl } }); document.querySelector('input[name="resumeGroup"]').value = 'changed-resume';
  check(!(await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token })).ok && clicks.length === 1, 'resume change invalidates the prepared confirmation');
  reset(); ready = await wubaApplyStep({ job: { url: jobUrl } }); wubaPrepared.at -= 31000;
  check(!(await wubaApplyStep({ job: { url: jobUrl }, phase: 'confirm', token: ready.token })).ok && clicks.length === 1, 'expired confirmation cannot submit');
  reset(); document.body.insertAdjacentHTML('beforeend', modalHtml.replace('Python实习生', '其他职位'));
  check(!(await wubaApplyStep({ job: { url: jobUrl } })).ok && clicks.length === 0, 'existing resume modal is never adopted as this operation');
  reset(); document.body.insertAdjacentHTML('beforeend', '<div class="guide-box">请先填写简历</div>');
  check(!(await wubaApplyStep({ job: { url: jobUrl } })).ok && clicks.length === 0, 'missing online resume cannot submit');
  return checks;
};
const html = join(fixture, 'ui.html'); writeFileSync(html, '<meta charset="utf-8"><body>Offline 58 job fixtures</body>');
const report = join(fixture, 'report.json'), entry = join(fixture, 'main.cjs'); mkdirSync(join(fixture, 'profile'));
writeFileSync(entry, `const {app,BrowserWindow}=require('electron');const fs=require('fs');app.setPath('userData',${JSON.stringify(join(fixture, 'profile'))});app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true}});w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));try{await w.loadFile(${JSON.stringify(html)});const checks=await w.webContents.executeJavaScript(${JSON.stringify('(' + runDom.toString() + ')(' + [domSource, step, jobHtml, modalHtml, jobUrl].map(JSON.stringify).join(',') + ')')});fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({checks}));}catch(e){fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack}));}finally{w.destroy();app.quit();}});`);
const electronEnv = { ...process.env }; delete electronEnv.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env: electronEnv, windowsHide: true, timeout: 45000, encoding: 'utf8' });
assert.equal(result.status, 0, result.error?.message || result.stderr);
const outcome = JSON.parse(readFileSync(report, 'utf8')); assert.ok(!outcome.error, outcome.error);
const pythonTest = `
import sys,tempfile,pathlib,itertools
from unittest.mock import patch
sys.path.insert(0,${JSON.stringify(join(root, 'camoufox'))})
with tempfile.TemporaryDirectory(dir=${JSON.stringify(fixture)}) as isolated:
    with patch.object(pathlib.Path,'home',return_value=pathlib.Path(isolated)):
        from platforms import registry,capabilities
        from platforms.wuba import WubaCollector,build_search_url
        import platforms.wuba as wuba
        assert registry.registry.has('wuba')
        assert capabilities.delivery_kind('wuba')=='resume'
        assert not capabilities.platform_supports('wuba','attach')
        assert build_search_url('Python','中山','',2)=='https://zs.58.com/quanzhizhaopin/pn2/?key=Python'
        c=WubaCollector()
        assert c.home_url==${JSON.stringify('https://www.58.com/changecity.html?catepath=quanzhizhaopin')}
        for city in ('','全国','不限','全部','不限制'):
            try:
                build_search_url('Python',city)
                raise AssertionError('nationwide must not produce a broken 58 URL')
            except ValueError as e:
                assert '选择具体城市' in str(e)
        assert c.deliver({'url':'https://evil58.com/tech/12345678901234x.shtml'},'fixture')['sent']==False
        assert c.handle_action_state('already')['sent']==False
        assert c.handle_action_state('risk')['code']==35
        class Locator:
            def click(self,**kwargs): self.clicked=True
        class Page:
            def __init__(self,answers): self.answers=iter(answers); self.control=Locator()
            def evaluate(self,*args): return next(self.answers)
            def locator(self,*args): return self.control
        c._expected_url=${JSON.stringify(jobUrl)}
        before={'title':'Python实习生','signals':[]}
        p=Page([{'kind':'resume_ready','resumeId':'fixture'},True,{'kind':'success'}])
        with patch.object(wuba,'human_sleep',return_value=None):
            assert c.finish_action(p,'',before)['sent']==True and p.control.clicked
        p=Page([{'kind':'risk','message':'验证码'}])
        assert c.finish_action(p,'',before)['sent']==False
        p=Page([{'kind':'ready'}])
        with patch.object(wuba,'human_sleep',return_value=None),patch.object(wuba.time,'monotonic',side_effect=itertools.count(0,8)):
            assert c.finish_action(p,'',before)['sent']==False
print('PASS 58 Python: registry, shared DOM, city URLs, no attachment capability, invalid target, duplicate, verification and confirmed/unconfirmed delivery; isolated profile.')
`;
const python = spawnSync(process.env.BOSSCLAW_PYTHON || 'python', ['-c', pythonTest], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
assert.equal(python.status, 0, python.stderr || python.error?.message); process.stdout.write(python.stdout);
console.log(`PASS 58: ${checks} platform/URL/target/Stop checks and ${outcome.checks.length} actual DOM/resume selection/result checks; zero platform submissions.`);
