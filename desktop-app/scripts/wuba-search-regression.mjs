// Native 58 search/filter contracts; synthetic profiles and documents, no platform submissions.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bossclaw-wuba-search-'));
const metadata = JSON.parse(readFileSync(join(root, 'camoufox/platforms/wuba-filters.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'electron/preload/wuba-categories.json'), 'utf8'));
const A = require('../electron/preload/platform-adapters.cjs');
const compiled = await build({ stdin: { contents: "export * from './src/lib/bossclaw/platformUrls';export * from './src/lib/bossclaw/wubaSearch';export * from './src/lib/bossclaw/collectionResume';export {DEFAULT_CONFIG} from './src/lib/bossclaw/defaults';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const env = { module: { exports: {} }, URL, URLSearchParams, Date, localStorage: { getItem: () => null } };
vm.createContext(env); vm.runInContext(compiled.outputFiles[0].text, env); const T = env.module.exports;
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const now = Date.parse('2026-10-16T08:00:00Z');
const cases = [];
for (const [name, field] of Object.entries(metadata.fields)) for (const option of field.options) {
  const criteria = { wubaSearchFilters: { [name]: option.label } };
  const params = T.wubaFilterParams(criteria, now);
  check(params[field.parameter] === option.value, `native ${field.label}: ${option.label}`);
  cases.push({ criteria, params });
}
for (const criteria of [
  { salary: '5-8K', degrees: ['本科'], experiences: ['1年以内'] },
  { salary: '15-25K', degrees: ['本科', '大专'], experiences: ['在校生', '应届生'] },
  { salary: '5-8K', degrees: ['本科'], experiences: ['1年以内'], wubaSearchFilters: { salary: '不限', degree: '不限', experience: '不限' } },
  { degrees: ['本科'], wubaSearchFilters: { degree: '硕士', industry: '计算机软件' } },
  ...metadata.publishedWithinDays.map(o => ({ wubaSearchFilters: { publishedWithinDays: o.days } })),
]) cases.push({ criteria, params: T.wubaFilterParams(criteria, now) });
check(!Object.keys(cases.find(c => c.criteria.salary === '15-25K').params).length, 'shared multi-select and cross-band salary never narrow arbitrarily');
check(!Object.keys(T.wubaFilterParams({ degrees: ['本科'], wubaSearchFilters: { degree: '不限' } })).length, 'explicit unlimited overrides shared single choice');
for (const value of ['无效选项', '<script>']) assert.throws(() => T.wubaFilterParams({ wubaSearchFilters: { degree: value } }), /重新选择/);
for (const value of [2, 1.5, -1, 'bad']) assert.throws(() => T.wubaFilterParams({ wubaSearchFilters: { publishedWithinDays: value } }), /无效/);
check(T.wubaFilterParams({ wubaSearchFilters: { publishedWithinDays: 7 } }, now).postdate === '20261010_20261017', 'publication dates follow native inclusive date range');
check(T.wubaFilterParams({ wubaSearchFilters: { publishedWithinDays: 1 } }, Date.parse('2026-10-15T16:00:00Z')).postdate === '20261016_20261017', 'publication midnight follows Asia/Shanghai');
const overrides = { degree: '本科', experience: '1年以下', salary: '5000-8000元', industry: '计算机软件' };
const urls = ['Vibe Coding', 'C++', 'AI / Python'].flatMap(keyword => [1, 2].map(page => ({ keyword, page,
  url: T.buildWubaSearchUrl({ keyword, city: '广州', page, criteria: { wubaSearchFilters: overrides } }) })));
for (const c of urls) {
  const u = new URL(c.url);
  check(u.searchParams.get('key') === c.keyword && u.searchParams.get('final') === '1' && !c.url.includes('+'), 'native keyword preserves spaces/literal plus and final classification flag');
  check(u.pathname === `/hulianwangtx/${c.page > 1 ? 'pn2/' : ''}pve_5354_5000_7999_pve_5356_6_pve_5357_4_pve_5363_245/`, 'occupation, all native path fields and page survive together');
}
check(T.wubaCategory().value === 'hulianwangtx' && T.wubaCategory({ industry: '计算机软件' }).value === 'hulianwangtx', 'legacy filters default to an IT occupation independently of employer industry');
const categoryUrls = categories.options.flatMap(option => [1, 2].map(page => {
  const criteria = { wubaSearchFilters: { ...overrides, category: option.value } };
  const url = T.buildWubaSearchUrl({ city: '广州', keyword: 'AI工具应用', page, criteria });
  check(new URL(url).pathname.startsWith(`/${option.value}/`) && A.isListPage('wuba', url), 'every supported occupation is an actual recognized list route: ' + option.label);
  check(new URL(url).searchParams.get('fullPath') === option.fullPath, 'native full occupation hierarchy is retained: ' + option.label);
  return { criteria, page, url };
}));
assert.throws(() => T.buildWubaSearchUrl({ city: '广州', criteria: { wubaSearchFilters: { category: '../quanzhizhaopin' } } }), /职位类别无效/);
check(!A.isListPage('wuba', 'https://gz.58.com/zufang/') && !A.isListPage('wuba', 'https://evil58.com/hulianwangtx/'), 'occupation support cannot turn unrelated pages into job lists');
const config = { ...structuredClone(T.DEFAULT_CONFIG), targetLocations: ['广州'] };
const direction = { items: [{ id: 'python', name: 'Python开发', enabled: true, keywords: ['Python'], priority: 1, score: 80 }] };
const oldQueue = T.buildPlatformSearchQueue('wuba', direction, config);
const oldSignature = T.collectionSignature(oldQueue, config);
const checkpoint = T.acknowledgeCollectionJob(T.beginCollection(oldQueue, oldSignature).checkpoint, 'old-factory-card', '旧总类岗位');
config.wubaSearchFilters = { category: 'npythonkf' };
const newQueue = T.buildPlatformSearchQueue('wuba', direction, config);
const next = T.beginCollection(newQueue, T.collectionSignature(newQueue, config), checkpoint);
check(next.changed && !next.checkpoint.processedKeys.length && newQueue.every(q => new URL(q.url).pathname.startsWith('/npythonkf/')), 'changing native occupation invalidates stale city/keyword card acknowledgments');

// Actual Settings controls and Zustand persistence, with network blocked by the Electron main process.
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Settings from './src/pages/Settings';import{useSettingsStore}from'./src/store/useSettingsStore';import{useAppStore}from'./src/store/useAppStore';import{platformSearchCriteria,buildWubaSearchUrl}from'./src/lib/bossclaw/platformUrls';
const t:any=window;t.settings=useSettingsStore;t.criteria=platformSearchCriteria;t.searchUrl=buildWubaSearchUrl;useAppStore.getState().setSettingsTab('platforms');createRoot(document.getElementById('root')!).render(<Settings isVisible={false}/>);`, resolveDir: root, loader: 'tsx' },
  tsconfig: join(root, 'tsconfig.json'), bundle: true, platform: 'browser', format: 'iife', outfile: join(fixture, 'ui.js'), logLevel: 'silent' });
writeFileSync(join(fixture, 'ui.html'), '<meta charset="utf-8"><div id="root"></div><script src="ui.js"></script>');
const domSource = readFileSync(join(root, 'electron/preload/wuba.cjs'), 'utf8');
const runChecks = async function (source) {
  const results = [], check = (v, s) => { if (!v) throw Error(s); results.push(s); };
  const module = { exports: {} }; new Function('module', source)(module); const W = module.exports;
  const card = (id, title = 'Python实习生') => `<li class="job_item"><div class="job_name"><a href="https://gz.58.com/tech/${id}x.shtml">天河 | ${title}</a></div><div class="job_salary">5000-8000元</div><div class="comp_name">合成公司</div></li>`;
  const marker = '<li class="job_item">暂无相关职位，为您提供以下职位</li>';
  const parse = html => new DOMParser().parseFromString('<ul>' + html + '</ul>', 'text/html');
  let d = parse(marker + card('11111111111111', '服务员'));
  check(W.listState(d).endReached && W.collect(d, 'https://gz.58.com/quanzhizhaopin/').length === 0, 'native recommendation-only list contains zero candidates');
  d = parse(card('22222222222222') + marker + card('11111111111111', '服务员'));
  check(W.collect(d, 'https://gz.58.com/quanzhizhaopin/').map(j => j.jobId).join() === '22222222222222', 'mixed list keeps matching jobs only before native separator');
  check(W.listState(d).resultCount === 1 && W.listState(d).recommendationCount === 1, 'matching/recommended counts stay separate');
  check(W.cardJob(d.querySelectorAll('.job_item')[2], 'https://gz.58.com/quanzhizhaopin/') === null, 'stale selected recommendation cannot enter JD enrichment');
  d = parse(card('22222222222222', '产品需求：暂无相关职位提示开发'));
  check(!W.listState(d).endReached && W.collect(d, 'https://gz.58.com/quanzhizhaopin/').length === 1, 'a real job mentioning empty-state words is retained');
  d.querySelector('ul').insertAdjacentHTML('afterbegin', marker.replace('暂无相关职位', '搜索结果：<span>暂无符合条件岗位</span>'));
  check(W.collect(d, 'https://gz.58.com/quanzhizhaopin/').length === 0, 'prefixed and wrapped native end marker excludes later cards');
  const scope = 'https://gz.58.com/hulianwangtx/?fullPath=674%2C413795';
  const categorized = (id, category) => card(id).replace('<a href=', `<a tracelogext='${JSON.stringify({ new_catepath: category })}' href=`);
  d = parse(categorized('22222222222222', '674,413795,413796,413801') + categorized('33333333333333', '674,413249,413425') + categorized('44444444444444', '674,413246,413287,413295'));
  check(W.collect(d, scope).map(j => j.jobId).join() === '22222222222222' && W.listState(d, scope).excludedCategoryCount === 2, 'native per-card category removes factory and mislabeled legacy-tech non-IT results');
  const unknown = parse(card('33333333333333') + categorized('44444444444444', '674,413795,invalid') + card('55555555555555').replace('<a href=', '<a tracelogext="invalid-json" href='));
  check(!W.collect(unknown, scope).length, 'missing, malformed and non-numeric occupation metadata cannot enter a restricted search');
  Object.defineProperty(d, 'readyState', { value: 'loading', configurable: true });
  check(!W.collect(d, scope).length && !W.listState(d, scope).endReached, 'streaming native DOM cannot publish cards before the trailing boundary is parsed');
  d = parse('<div class="noData">抱歉，暂时没有符合该条件的职位，请重新修改搜索条件后再搜索、筛选</div><div id="pc_list_rec">' + categorized('33333333333333', '674,413249,413425') + '</div>');
  check(W.listState(d, scope).endReached && W.collect(d, scope).length === 0 && W.listState(d, scope).recommendationCount === 1, 'native noData completes empty pages while supplementary recommendations stay excluded');
  d = parse('<div id="list_con">' + categorized('22222222222222', '674,413795,413796,413801') + '</div><div id="pc_list_rec">' + categorized('55555555555555', '674,413795,413796,413801') + '</div>');
  check(W.collect(d, scope).map(j => j.jobId).join() === '22222222222222', 'recommendation containers outside the native result list never enter collection, even in the same category');
  check(W.jobIdentity('https://gz.58.com/rengongzhn/22222222222222x.shtml') === '22222222222222' && W.jobIdentity('https://gz.58.com/zhikonganfang/22222222222222x.shtml') === '22222222222222', 'native AI and technical testing detail paths remain identifiable');
  const target = 'https://gz.58.com/npythonkf/?key=Vibe%20Coding&final=1&fullPath=674%2C413795%2C413796%2C413801';
  check(W.searchScopeMatches(target, target), 'native occupation and keyword scope match');
  for (const wrong of [target.replace('/npythonkf/', '/quanzhizhaopin/'), target.replace('gz.58.com', 'sz.58.com'), target.replace('Vibe%20Coding', '普工'), target.replace('gz.58.com', 'gz.58.com.evil.test'), target.replace('413795', '413892')]) {
    check(!W.searchScopeMatches(wrong, target), 'wrong occupation/city/keyword/origin cannot become a matching search');
  }
  const wait = async (fn, label) => { const end = Date.now() + 8000; while (!fn()) { if (Date.now() > end) throw Error(label); await new Promise(r => setTimeout(r, 30)); } };
  await wait(() => document.querySelector('[data-testid="wuba-search-filters"]'), 'actual 58 settings card rendered');
  check(document.querySelector('[data-testid="wuba-search-filters"]').textContent.includes('互联网/通信'), 'actual legacy Settings starts inside the IT occupation');
  const choices = ['Python开发', '七天以内', '5000-8000元', '本科', '1年以下', '计算机软件'];
  for (let i = 0; i < choices.length; i++) {
    const input = document.querySelectorAll('[data-testid="wuba-search-filters"] .ant-select input')[i];
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(() => [...document.querySelectorAll('.ant-select-item-option')].some(e => e.getAttribute('title') === choices[i]), 'native option dropdown: ' + choices[i]);
    const option = [...document.querySelectorAll('.ant-select-item-option')].find(e => e.getAttribute('title') === choices[i]);
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
  }
  const selected = window.settings.getState().config.wubaSearchFilters;
  check(selected.category === 'npythonkf' && selected.publishedWithinDays === 7 && selected.salary === choices[2] && selected.degree === choices[3] && selected.experience === choices[4] && selected.industry === choices[5], 'actual UI keeps occupation and all five filters independently');
  await wait(() => JSON.parse(localStorage.getItem('bossclaw-settings-v2') || '{}').state?.config?.wubaSearchFilters?.industry === choices[5], 'settings disk persistence');
  const saved = JSON.parse(localStorage.getItem('bossclaw-settings-v2')).state;
  const merged = window.settings.persist.getOptions().merge(saved, window.settings.getState());
  check(JSON.stringify(merged.config.wubaSearchFilters) === JSON.stringify(selected), 'saved filters survive hydration');
  const criteria = window.criteria(merged.config), url = window.searchUrl({ city: '广州', keyword: 'Vibe Coding', criteria });
  check(new URL(url).pathname.startsWith('/npythonkf/') && url.includes('pve_5356_6') && url.includes('pve_5363_245') && url.includes('postdate=') && url.includes('Vibe%20Coding') && url.includes('final=1'), 'saved occupation and Settings feed the actual native search URL');
  return results;
};
const reportPath = join(fixture, 'report.json'), entry = join(fixture, 'main.cjs');
writeFileSync(entry, `const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(fixture, 'profile'))});app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true}});w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));try{await w.loadFile(${JSON.stringify(join(fixture, 'ui.html'))});const checks=await w.webContents.executeJavaScript('('+${JSON.stringify(runChecks.toString())}+')('+${JSON.stringify(JSON.stringify(domSource))}+')');fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({checks}));}catch(e){fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:e.stack}));}finally{w.destroy();app.quit();}});`);
const electronEnv = { ...process.env }; delete electronEnv.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env: electronEnv, windowsHide: true, timeout: 45000, encoding: 'utf8' });
assert.equal(result.status, 0, result.error?.message || result.stderr);
const report = JSON.parse(readFileSync(reportPath, 'utf8')); assert.ok(!report.error, report.error);

const pythonScript = `
import sys,pathlib,tempfile
from unittest.mock import patch,Mock
from contextlib import contextmanager
sys.path.insert(0,${JSON.stringify(join(root, 'camoufox'))})
with tempfile.TemporaryDirectory(dir=${JSON.stringify(fixture)}) as home:
 with patch.object(pathlib.Path,'home',return_value=pathlib.Path(home)):
  from platforms.wuba_filters import filter_params
  from platforms.wuba import WubaCollector,build_search_url
  from platforms import base
  import json
  for case in json.loads(${JSON.stringify(JSON.stringify(cases))}):
   assert filter_params(case['criteria'],now=${now / 1000})==case['params'],case
  for case in json.loads(${JSON.stringify(JSON.stringify(urls))}):
   assert build_search_url(case['keyword'],'广州',page=case['page'],criteria={'wubaSearchFilters':${JSON.stringify(overrides)}})==case['url']
  for case in json.loads(${JSON.stringify(JSON.stringify(categoryUrls))}):
   assert build_search_url('AI工具应用','广州',page=case['page'],criteria=case['criteria'])==case['url']
  for value in (2,1.5,-1,'bad'):
   try: filter_params({'wubaSearchFilters':{'publishedWithinDays':value}});raise AssertionError('invalid date accepted')
   except ValueError: pass
  class Page:
   def __init__(self,jobs,ready,exhausted,scope=True): self.jobs=jobs;self.ready=ready;self.exhausted=exhausted;self.scope=scope
   def on(self,*args): pass
   def evaluate(self,js,*args):
    if 'return W.collect' in js: return self.jobs
    if 's.endReached||s.resultCount>0' in js: return self.ready and self.scope
    if 'return W.listState(document).endReached' in js: return self.exhausted
    raise AssertionError(js)
  for jobs,ready,exhausted,scope in (([],True,True,True),([{'jobId':'22222222222222','title':'Python实习生'}],True,True,True),([],False,False,True),([{'jobId':'11111111111111','title':'普工'}],True,False,False)):
   page=Page(jobs,ready,exhausted,scope);store=Mock();store.completed_combo.return_value=False
   @contextmanager
   def browser(**kwargs): yield page
   with patch.object(base,'progress_store',return_value=store),patch.object(base,'open_browser',browser),patch.object(base,'load_cookies',return_value=[]),patch.object(base,'goto_stable',return_value=True) as navigate,patch.object(base,'risk_text_hit',return_value=None),patch.object(base,'human_sleep'):
    result=WubaCollector().search_jobs('Vibe Coding','广州',pages=5)
   assert navigate.call_count==1,'native boundary or failed page must not load more pages'
   if ready and scope:
    assert result['ok'] and result['jobs']==jobs and result['pages']==1
    assert store.mark_combo_done.call_count==1,'completed combo advances exactly once'
    assert store.mark_combo_done.call_args.kwargs['count']==len(jobs)
   else:
    assert not result['ok'] and result['code']==37 and not store.mark_combo_done.called
print('PASS 58 Python native filters, URL parity, explicit end completion, mixed/zero results and unknown page failure; no network.')
`;
const python = spawnSync(process.env.BOSSCLAW_PYTHON || 'python', ['-c', pythonScript], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
assert.equal(python.status, 0, python.stderr || python.error?.message); process.stdout.write(python.stdout);
console.log(`PASS 58 search: ${checks} native filter/URL checks and ${report.checks.length} actual DOM/Settings/persistence checks; zero platform requests.`);
