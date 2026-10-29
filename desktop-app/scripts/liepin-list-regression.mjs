// Captured Liepin empty-state DOM and production list loop. All pages and I/O are offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = fs.mkdtempSync(path.join(process.env.BOSSCLAW_TEST_TMP || os.tmpdir(), 'bossclaw-liepin-list-'));
const bundle = await build({ stdin: { contents: `export * from './src/lib/bossclaw/platformUrls';export{DEFAULT_CONFIG}from'./src/lib/bossclaw/defaults';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const ctx = { module: { exports: {} }, URL, URLSearchParams, console }; vm.runInNewContext(bundle.outputFiles[0].text, ctx);
const T = ctx.module.exports, config = { ...structuredClone(T.DEFAULT_CONFIG), degrees: ['大专', '本科'], experiences: ['实习生'], targetLocations: ['广州', '深圳'], employmentTypes: ['实习'] };
const plan = { confirmed: true, items: [{ id: 'synthetic', enabled: true, name: 'AI开发', priority: 1, score: 80, keywords: ['Vibe Coding', 'C++ AI'] }] };
const queue = T.buildPlatformSearchQueue('liepin', plan, config);
assert.equal(queue.length, 8);
assert.deepEqual(Array.from(queue, q => q.location), ['广州', '广州', '广州', '广州', '深圳', '深圳', '深圳', '深圳']);
assert.ok(queue.every(q => q.criteria.degrees.length === 1 && ['050', '040'].includes(new URL(q.url).searchParams.get('eduLevel'))));
assert.ok(queue.every(q => decodeURIComponent(q.url.match(/[?&]key=([^&]*)/)[1]) === q.keyword));
assert.ok(!queue.some(q => /[?&]key=[^&]*\+|eduLevel=\d+\$/.test(q.url)));
assert.deepEqual(config.degrees, ['大专', '本科']);
assert.equal(T.buildPlatformSearchQueue('liepin', plan, { ...config, collectWithoutKeyword: true }).length, 4);
const workbench = ts.createSourceFile('Workbench.tsx', fs.readFileSync(path.join(root, 'src/pages/Workbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let runIdSource; const findId = n => { if (ts.isVariableDeclaration(n) && n.name.getText(workbench) === 'collectRunId') runIdSource = n.initializer.getText(workbench); ts.forEachChild(n, findId); }; findId(workbench);
const idContext = { COLLECT_RUN_PREFIX: 'cr_' }; vm.runInNewContext(ts.transpile(`globalThis.makeId=${runIdSource};`), idContext);
assert.equal(new Set(queue.map(q => idContext.makeId('liepin', q))).size, queue.length);
const source = ts.createSourceFile('webview.cjs', fs.readFileSync(path.join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), functions = new Map();
const visit = n => { if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(source)); ts.forEachChild(n, visit); }; visit(source);
const helper = fs.readFileSync(path.join(root, 'electron/preload/liepin-list.cjs'), 'utf8');
const expected = 'https://www.liepin.com/zhaopin/?city=050020&dq=050020&currentPage=0&key=Vibe%20Coding&workYearCode=2&eduLevel=040';
const markup = '<meta charset="utf-8"><style>.ant-empty-description{padding:10px}.content-left-section{width:500px;min-height:200px}</style><input placeholder="搜索职位、公司" value="Vibe Coding"><main class="content-left-section"><div class="ant-empty"><div class="ant-empty-description">非常抱歉！暂时没有合适的职位</div></div></main>';
const test = async function (helper, functions, expected) {
  const checks = [], check = (v, label) => { if (!v) throw Error(label); checks.push(label); };
  const module = { exports: {} }; new Function('module', helper)(module); const L = module.exports;
  check(L.searchScopeMatches(location.href, expected, document), 'target Liepin city/keyword/native filters are accepted');
  check(!L.searchScopeMatches('https://c.liepin.com/', expected, document), 'old home-page cards cannot admit the next search');
  check(!L.searchScopeMatches(location.href, expected.replace('050020', '050090'), document), 'wrong city is rejected');
  check(!L.searchScopeMatches(location.href, expected.replace('Vibe%20Coding', 'Python'), document), 'wrong keyword is rejected');
  const input = document.querySelector('input'); input.value = 'Vibe+Coding';
  check(!L.searchScopeMatches(location.href, expected, document), 'literal plus in the rendered search box is not accepted as a space'); input.value = 'Vibe Coding';
  check(L.explicitlyEmpty(document, location.href), 'captured official empty-state phrase is recognized in its results container');
  const message = document.querySelector('.ant-empty-description'); message.style.display = 'none';
  check(!L.explicitlyEmpty(document, location.href), 'hidden stale empty markers cannot complete a search'); message.style.display = '';
  document.body.insertAdjacentHTML('beforeend', '<div id="challenge">安全验证：请输入验证码</div>');
  check(!L.explicitlyEmpty(document, location.href), 'verification text takes precedence over an old empty-state marker'); document.getElementById('challenge').remove();
  return new Function('LIEPIN_LIST', 'expected', 'checks', 'check', `return (async()=>{
    const PLATFORM='liepin',PLATFORM_LABEL='猎聘',location=window.location,collectCtl={},WUBA={};
    const LINK_SELECTOR='a[href*="/job/"],a[href*="/a/"]';
    let tick=0,events=[],stopAtStart=false,onSleep=()=>{};const Date={now:()=>tick};
    const liepinLoginConfirmation=LIEPIN_LIST.createLoginConfirmation(()=>tick);
    const collectNotify=(channel,data)=>{events.push({channel,data});if(stopAtStart&&data.phase==='start')collectCtl.stopped=true;};
    const resetJdFillState=()=>{},reportJdFillSummary=()=>{},sleep=async ms=>{tick+=ms;onSleep();},waitWhilePaused=async()=>{},
      smoothScrollIntoView=async()=>{},highlightElement=()=>{},enrichJobDetail=async()=>{},
      readZhaopinPageBlock=()=>null,collectCards=()=>Array.from(document.querySelectorAll('.jobCardPcContainer')),
      collectCardKey=c=>c.id,cardIdentity=c=>({title:'合成岗位',company:'合成公司'}),extractJobFromCardOnly=c=>({jobId:c.id,title:'合成岗位'}),textOf=e=>e.innerText,all=s=>Array.from(document.querySelectorAll(s));
    ${functions.join('\n')}
    const collect=async()=>{events=[];tick=0;await visualCollectListOnly({seq:'offline',maxJobs:5,autoScroll:false,listTimeoutMs:30000,expectedSearchUrl:expected});return events.find(e=>e.channel==='collect-done')?.data;};
    let result=await collect();check(result?.reason==='completed'&&result.empty&&tick===0,'explicit empty results complete immediately rather than failing after 30 seconds');
    document.querySelector('.content-left-section').innerHTML='<div class="render-error">搜索渲染异常</div>';
    result=await collect();check(result?.reason==='failed'&&!result.empty,'unknown empty-looking pages preserve the checkpoint as a failure');
    document.querySelector('.content-left-section').innerHTML='<div class="ant-empty-description">非常抱歉！暂时没有合适的职位</div>';const input=document.querySelector('input');
    input.value='Another keyword';result=await collect();check(result?.reason==='failed','an empty old search cannot complete the target keyword');input.value='Vibe Coding';
    stopAtStart=true;result=await collect();check(result?.reason==='stopped','Stop cannot be converted into an empty successful search');stopAtStart=false;
    document.querySelector('.content-left-section').innerHTML='<div class="jobCardPcContainer" id="synthetic">合成 Python 开发实习岗位</div>';
    result=await collect();check(result?.reason==='completed'&&events.filter(e=>e.data.phase==='done').length===1,'populated lists still publish jobs and complete normally');
    const root=document.querySelector('.content-left-section');
    const card='<div class="jobCardPcContainer" id="delayed"><a href="/job/0000000000.shtml">合成岗位</a></div>';
    root.innerHTML='<nav>登录/注册 扫码登录 验证码</nav><div>搜索页面加载中</div>';
    onSleep=()=>{root.innerHTML=card;};
    result=await collect();onSleep=()=>{};
    check(result?.reason==='completed'&&events.some(e=>e.data.phase==='done')&&!events.some(e=>e.data.loginRequired),
      'logged-in shell with login copy waits for delayed cards instead of aborting');
    const form='<form><input type="tel" placeholder="手机号"><button>登录</button></form>';
    root.innerHTML=form;onSleep=()=>{root.innerHTML=card;};
    result=await collect();onSleep=()=>{};
    check(result?.reason==='completed'&&!events.some(e=>e.data.loginRequired),'transient auth form replaced by authenticated results does not report logout');
    root.innerHTML=form+'<div class="loading" style="position:fixed;inset:0;width:100vw;height:100vh">加载中</div>';
    onSleep=()=>{if(tick>=2000)root.innerHTML=card;};result=await collect();onSleep=()=>{};
    check(result?.reason==='completed'&&!events.some(e=>e.data.loginRequired),'loading overlay prevents form confirmation even after 1.5 seconds of hydration');
    root.innerHTML=form;result=await collect();
    check(result?.loginRequired&&result.reason==='blocked'&&tick>=1500,'persistent real credential form is confirmed before stopping collection');
    root.innerHTML='<div role="dialog" class="captcha">安全验证，请拖动滑块</div>';result=await collect();
    check(result?.reason==='blocked'&&!result.loginRequired&&tick===0,'actual CAPTCHA stops immediately without being labelled logged out');
    return checks;
  })()`)(L, expected, checks, check);
};
const pageStatusTest = function(helper, functions, expected) {
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const module={exports:{}};new Function('module',helper)(module);
  return new Function('LIEPIN_LIST','expected','checks','check',`return (()=>{
    const PLATFORM='liepin',PLATFORM_LIST_SELECTORS={liepin:['.jobCardPcContainer']},LINK_SELECTOR='a[href*="/job/"],a[href*="/a/"]',LIST_ROOT_SELECTORS=['.content-left-section'];
    const location={href:expected,pathname:'/zhaopin/',search:new URL(expected).search},ADAPTERS={},readBossPageBlock=()=>null,reportBossRestriction=()=>{};
    const all=s=>Array.from(document.querySelectorAll(s)),$=s=>document.querySelector(s),textOf=e=>e.innerText;
    const collectCards=()=>all('.jobCardPcContainer');let now=0,state='complete';
    let liepinLoginConfirmation=LIEPIN_LIST.createLoginConfirmation(()=>now);
    const original=Object.getOwnPropertyDescriptor(document,'readyState');
    Object.defineProperty(document,'readyState',{configurable:true,get:()=>state});
    const show=html=>{document.body.innerHTML=html;liepinLoginConfirmation=LIEPIN_LIST.createLoginConfirmation(()=>now);};
    ${functions.join('\n')}
    try {
      show('<header>登录/注册 扫码登录 请输入验证码</header><main class="content-left-section">加载中</main>');state='interactive';
      let st=pageStatusData(expected);
      check(!st.loginWall&&!st.loginWallPending&&!st.collectionBlocked,'interactive zero-card shell with login/captcha words is not login evidence');
      location.href=expected+'&returnUrl='+encodeURIComponent('https://passport.liepin.com/login?verify=1');
      check(!pageStatusData(expected).loginWall,'login and verify words inside a query/return URL do not create a login wall');location.href=expected;
      const form='<form><input type="tel" placeholder="手机号"><button>登录</button></form>';
      show(form);now=100;state='interactive';st=pageStatusData(expected);
      check(!st.loginWall&&st.loginWallPending,'interactive credential form remains pending while authentication hydrates');
      now=2000;check(!pageStatusData(expected).loginWall,'time spent interactive does not count toward stable login confirmation');
      state='complete';st=pageStatusData(expected);now=3499;
      check(!st.loginWall&&!pageStatusData(expected).loginWall,'complete credential form requires the full confirmation interval');
      now=3500;st=pageStatusData(expected);
      check(st.loginWall&&st.loginWallSource==='login-form'&&!st.collectionBlocked,'stable visible credential form confirms a real login wall');
      show(form);now=4000;pageStatusData(expected);now=4300;
      document.body.innerHTML='<header>扫码登录 验证码</header><main class="content-left-section">'+Array.from({length:5},(_,i)=>'<div class="jobCardPcContainer"><a href="/job/000000000'+i+'.shtml">合成开发岗位</a></div>').join('')+'</main>';
      st=pageStatusData(expected);check(st.cards===5&&!st.loginWall&&!st.loginWallPending,'authenticated five-card results cancel transient login evidence');
      document.body.insertAdjacentHTML('beforeend',form);
      check(!pageStatusData(expected).loginWallPending,'optional login form cannot block an already populated results list');
      show('<div style="display:none">'+form+'</div><header>登录/注册 验证码</header>');state='complete';
      check(!pageStatusData(expected).loginWallPending&&!pageStatusData(expected).loginWall,'hidden login forms and navigation text are ignored');
      show('<div class="captcha" role="dialog" style="opacity:0">安全验证，请拖动滑块</div>');
      check(!pageStatusData(expected).collectionBlocked,'invisible stale CAPTCHA widgets do not falsely block an authenticated shell');
      show(form);location.href='https://passport.liepin.com/login';state='interactive';
      st=pageStatusData(expected);check(st.loginWall&&st.loginWallSource==='auth-url','actual auth destination remains an immediate login stop');
      location.href=expected;state='complete';show('<div class="captcha" role="dialog">安全验证，请拖动滑块</div>');
      st=pageStatusData(expected);check(st.collectionBlocked&&!st.loginWall,'visible CAPTCHA is classified as a verification block, not a login wall');
      show('<h1>安全验证</h1>');check(pageStatusData(expected).collectionBlocked,'full-page verification heading still blocks collection');
      show('<div>loading</div>');location.href='https://www.liepin.com/verify/';
      st=pageStatusData(expected);check(st.collectionBlocked&&!st.loginWall,'verification URL stops safely without reporting login loss');
      return checks;
    } finally {if(original)Object.defineProperty(document,'readyState',original);else delete document.readyState;}
  })()`)(module.exports,expected,checks,check);
};
// The fixture uses the exact result structure, but contains no account or employer data.
const entry = path.join(fixture, 'main.cjs'), report = path.join(fixture, 'report.json');
fs.writeFileSync(entry, `const{app,BrowserWindow,session}=require('electron'),fs=require('fs');
app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});
app.whenReady().then(async()=>{
  const s=session.fromPartition('liepin-list-offline');let other=0;
  s.protocol.handle('https',r=>{if(r.url!==${JSON.stringify(expected)})other++;return new Response(${JSON.stringify(markup)},{headers:{'content-type':'text/html;charset=utf-8'}});});
  const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{session:s,sandbox:true,contextIsolation:true}});
  try {
    await w.loadURL(${JSON.stringify(expected)});
    const checks=await w.webContents.executeJavaScript('('+${JSON.stringify(test.toString())}+')('+${JSON.stringify(JSON.stringify(helper))}+','+${JSON.stringify(JSON.stringify(['loginWallDetected','collectionListExplicitlyEmpty','visualCollectListOnly'].map(n=>functions.get(n))))}+','+${JSON.stringify(JSON.stringify(expected))}+')');
    checks.push(...await w.webContents.executeJavaScript('('+${JSON.stringify(pageStatusTest.toString())}+')('+${JSON.stringify(JSON.stringify(helper))}+','+${JSON.stringify(JSON.stringify(['loginWallDetected','pageStatusData'].map(n=>functions.get(n))))}+','+${JSON.stringify(JSON.stringify(expected))}+')'));
    if(other)throw Error('Unexpected platform request');
    fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({checks}));
  } catch(e) { fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack})); }
  finally {w.destroy();app.quit();}
});`);
const electronEnv = { ...process.env }; delete electronEnv.ELECTRON_RUN_AS_NODE;
const run = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env: electronEnv, windowsHide: true, timeout: 45000, encoding: 'utf8' });
assert.equal(run.status, 0, run.error?.message || run.stderr);
const outcome = JSON.parse(fs.readFileSync(report, 'utf8')); assert.ok(!outcome.error, outcome.error);
const py = path.join(fixture, 'liepin-url.py');
fs.writeFileSync(py, `import ast,importlib.util,json,pathlib,urllib.parse,sys,types
root=pathlib.Path(${JSON.stringify(root)})
package=types.ModuleType('liepin_fixture');package.__path__=[str(root/'camoufox/platforms')];sys.modules['liepin_fixture']=package
spec=importlib.util.spec_from_file_location('liepin_fixture.filters',root/'camoufox/platforms/filters.py');filters=importlib.util.module_from_spec(spec);spec.loader.exec_module(filters)
tree=ast.parse((root/'camoufox/platforms/liepin.py').read_text(encoding='utf-8'))
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='build_search_url')
scope={'quote':urllib.parse.quote,'PLATFORM':'liepin','_resolve_city':lambda city:'050020','_resolve_salary':lambda salary:'','build_filter_params':filters.build_filter_params}
exec(compile(ast.Module(body=[node],type_ignores=[]),'production-liepin-url','exec'),scope)
keyword='C++ AI & 数据'
url=scope['build_search_url'](keyword,'广州','',criteria={'degrees':['本科']})
assert '%20' in url and '+' not in url and urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['key']==[keyword]
assert filters.build_filter_params('liepin',{'degrees':['本科']})['eduLevel']=='040'
try: filters.build_filter_params('liepin',{'degrees':['大专','本科']})
except ValueError: pass
else: raise AssertionError('Unsupported multi-degree native filter was accepted')
print('PASS Liepin Python search: encoded keyword, single-degree filters and unsupported-filter rejection; no browser/network.')
`);
const python = spawnSync(process.env.BOSSCLAW_PYTHON || 'python', [py], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
assert.equal(python.status, 0, python.error?.message || python.stderr);
console.log(`PASS Liepin list recovery: 8 real search-queue/task identity checks and ${outcome.checks.length} actual DOM/scope/empty/Stop checks; zero platform requests.`);
process.stdout.write(python.stdout);
await import('./liepin-url-regression.mjs');
