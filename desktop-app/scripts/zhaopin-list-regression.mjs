// Actual native card bridge and list-only collector. Isolated profile; all URLs served offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = fs.mkdtempSync(path.join(process.env.BOSSCLAW_TEST_TMP || os.tmpdir(), 'bossclaw-zhaopin-list-'));
const A = require('../electron/preload/platform-adapters.cjs'), Z = require('../electron/preload/zhaopin-list.cjs');
const expected = 'https://www.zhaopin.com/sou/jl763/p1?kw=Python&el=5,4&et=4,2,5';
const actual = 'https://www.zhaopin.com/jobs/?jl=763&kw=Python&el=4%2C5&et=5%2C2%2C4';
assert.ok(Z.searchScopeMatches(actual, expected));
for (const wrong of [actual.replace('Python', 'Java'), actual.replace('763', '765'), actual.replace('el=4%2C5', 'el=4'),
  actual.replace('et=5%2C2%2C4', 'et=4'), actual.replace('www.zhaopin.com', 'www.zhaopin.com.evil.test'), actual.replace('https:', 'http:'),
  actual.replace('/jobs/', '/jobdetail/example.htm'), 'invalid']) assert.ok(!Z.searchScopeMatches(wrong, expected), wrong);
function parse(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), functions = new Map(), variables = new Map();
  const scan = n => { if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(ast));
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !variables.has(n.name.text)) variables.set(n.name.text, n.initializer.getText(ast)); ts.forEachChild(n, scan); }; scan(ast);
  return { functions, variables };
}
const main = parse('electron/main.cjs'), preload = parse('electron/preload/webview.cjs');
const bridge = vm.runInNewContext(main.variables.get('ZP_DETAIL_NAV_SCRIPT'), { require: createRequire(path.join(root, 'electron/main.cjs')) });
const functions = ['visible', 'textOf', 'rawLines', 'pickFromCard', 'zhaopinTitleFromCard', 'cardIdentity', 'cardJobTokens', 'collectCards',
  'collectionListExplicitlyEmpty', 'visualCollectListOnly', 'pageStatusData'];
const setup = `const ADAPTERS=${JSON.stringify(A)},PLATFORM='zhaopin',PLATFORM_LIST_SELECTORS=ADAPTERS.PLATFORM_CARD_SELECTORS,FIELD_SELECTORS=ADAPTERS.PLATFORM_FIELD_SELECTORS.zhaopin,LINK_SELECTOR=ADAPTERS.PLATFORM_LINK_SELECTOR.zhaopin,LIST_ROOT_SELECTORS=ADAPTERS.PLATFORM_LIST_ROOT_SELECTORS.zhaopin;
const PLATFORM_LABEL='智联';const detectPlatform=${A.detectPlatform.toString()};ADAPTERS.jobIdFromUrl=${A.jobIdFromUrl.toString()};
const ZHAOPIN_LIST=(()=>{const module={exports:{}};new Function('module',${JSON.stringify(fs.readFileSync(path.join(root, 'electron/preload/zhaopin-list.cjs'), 'utf8'))})(module);return module.exports;})();
const readZhaopinPageBlock=(()=>{const module={exports:{}};new Function('module',${JSON.stringify(fs.readFileSync(path.join(root, 'electron/preload/zhaopin-page-block.cjs'), 'utf8'))})(module);return module.exports.readZhaopinPageBlock;})();
const all=(s,scope=document)=>Array.from(scope.querySelectorAll(s)),$=s=>document.querySelector(s),cleanCompanyName=s=>String(s||''),looksLikeLocation=()=>false;
let events=[],afterFirst='',tick=globalThis.Date.now();const RealDate=globalThis.Date;class Date extends RealDate{static now(){return tick;}}
const collectCtl={},sleep=async ms=>{tick+=ms;},waitWhilePaused=async()=>{},resetJdFillState=()=>{},reportJdFillSummary=()=>{},smoothScrollIntoView=async()=>{},highlightElement=()=>{},enrichJobDetail=async()=>{},loginWallDetected=()=>false,readBossPageBlock=()=>null,readZhaopinChatReady=()=>false;
const collectNotify=(channel,data)=>{events.push({channel,data});if(data.phase==='done'&&afterFirst){if(afterFirst==='stop')collectCtl.stopped=true;else document.body.insertAdjacentHTML('beforeend','<div id="challenge" class="geetest_panel" style="width:300px;height:150px">请完成安全验证<canvas width="250" height="100"></canvas></div>');afterFirst='';}},notify=collectNotify;
${['CARD_LINE_NOISE', 'SALARY_LINE_RE', 'SALARY_TEXT_RE', 'SALARY_WHOLE_RE'].map(n => `const ${n}=${preload.variables.get(n)};`).join('\n')}
${functions.map(n => preload.functions.get(n)).join('\n')}
const collectCardKey=card=>cardIdentity(card).href,extractJobFromCardOnly=card=>({...cardIdentity(card),jobId:card.getAttribute('data-bossclaw-native-job')});`;
const markup = `<meta charset="utf-8"><style>.job-card{width:360px;min-height:90px;padding:8px}.job-card__company-name{display:block}</style><div class="job-list-panel">${[1, 2].map(i => `<div class="job-card" id="card${i}"><div class="job-card__title-main"><div class="job-card__title-clamp vue-clamp"><span><span class="vue-clamp__text" aria-label=""></span></span></div></div><span class="job-card__salary">160-180元/天</span><a class="job-card__company-name">示例公司${i}</a></div>`).join('')}</div>`;
const runChecks = async function (bridge, setup, expected) {
  const checks = [], check = (v, s) => { if (!v) throw Error(s); checks.push(s); };
  const later = () => new Promise(r => setTimeout(r, 380));
  for (const i of [1, 2]) {
    const e = document.getElementById('card' + i), job = { name: '网络工具实习岗位' + i, companyName: '示例公司' + i, number: 'CC000000001J00000000' + i };
    job.positionURL = 'https://www.zhaopin.com/jobdetail/' + job.number + '.htm';
    e.__vue__ = { $options: { name: 'JobCard' }, $props: { job } };
    e.querySelector('.vue-clamp').__vue__ = { $props: { content: job.name } };
  }
  // A stale SSR array has the same companies but different jobs. It must never
  // override each rendered card's own current model, even when titles are blank.
  window.__INITIAL_STATE__ = { positionList: [{ name: '过期示例岗位', number: 'CC000000009J000000009', companyName: '示例公司1' }] };
  return await new Function('bridge', 'expected', 'check', 'later', 'checks', `return (async()=>{${setup}
    check(collectCards(true).length===0,'captured empty VueClamp titles reproduce zero recognized cards');
    (0,eval)(bridge);
    let cards=collectCards(true);
    check(cards.length===2&&cards.every(c=>cardIdentity(c).title===c.__vue__.$props.job.name),'production main-world annotation restores both exact native titles');
    check(cards.every(c=>cardIdentity(c).href.endsWith('/'+c.__vue__.$props.job.number+'.htm')),'each recovered detail URL belongs to its own card, not the stale SSR index');
    const c=document.getElementById('card1'),job=c.__vue__.$props.job;
    job.name='更新后的网络岗位';job.number='CC000000001J000000003';job.positionURL='https://www.zhaopin.com/jobdetail/'+job.number+'.htm';c.querySelector('.vue-clamp').__vue__.$props.content=job.name;c.append(document.createComment('reused'));await later();
    check(cardIdentity(c).title===job.name&&cardIdentity(c).href.includes(job.number),'a reused native card replaces both previous title and number');
    c.querySelector('.job-card__company-name').textContent='尚未更新的另一公司';await later();
    check(!c.hasAttribute('data-bossclaw-jobtitle')&&!c.hasAttribute('data-bossclaw-jobdetail'),'mismatched visible company removes stale annotations instead of falling back to SSR');
    c.querySelector('.job-card__company-name').textContent=job.companyName;await later();
    job.positionURL='https://evil.test/jobdetail/'+job.number+'.htm';c.append(document.createComment('bad-url'));await later();
    check(!c.hasAttribute('data-bossclaw-jobdetail'),'a native foreign-domain URL is rejected before collection');
    job.positionURL='https://www.zhaopin.com/jobdetail/'+job.number+'.htm';c.append(document.createComment('ready'));await later();
    check(pageStatusData(expected).collectionScopeMatches&&!pageStatusData(expected.replace('Python','Java')).collectionScopeMatches,'real page probe distinguishes canonical redirect from the previous keyword');
    const collect=async extra=>{events=[];await visualCollectListOnly({seq:'fixture',maxJobs:10,autoScroll:false,listTimeoutMs:5000,expectedSearchUrl:expected,...extra});return events;};
    let result=await collect({});
    check(result.filter(e=>e.data.phase==='done').length===2&&result.some(e=>e.channel==='collect-done'&&e.data.reason==='completed'),'actual list-only collector processes restored native cards and completes');
    result=await collect({expectedSearchUrl:expected.replace('Python','Java')});
    check(!result.some(e=>e.data.phase==='done')&&result.some(e=>e.channel==='collect-done'&&e.data.reason==='failed'),'wrong keyword never publishes cards or completes the checkpoint');
    document.body.insertAdjacentHTML('beforeend','<div id="challenge" class="geetest_panel" style="width:300px;height:150px">请完成安全验证<canvas width="250" height="100"></canvas></div>');
    check(!!pageStatusData(expected).collectionBlocked,'actual native CAPTCHA detector blocks page readiness');
    result=await collect({});check(!result.some(e=>e.data.phase==='done')&&result.some(e=>e.channel==='collect-done'&&e.data.reason==='blocked'),'CAPTCHA returns blocked rather than failed, preventing automatic reload');document.getElementById('challenge').remove();
    afterFirst='risk';result=await collect({});check(result.filter(e=>e.data.phase==='done').length===1&&result.some(e=>e.channel==='collect-done'&&e.data.reason==='blocked'),'a CAPTCHA appearing during collection stops before another card');document.getElementById('challenge').remove();
    afterFirst='stop';result=await collect({});check(result.filter(e=>e.data.phase==='done').length===1&&result.some(e=>e.channel==='collect-done'&&e.data.reason==='stopped'),'Stop prevents the next native card and reports an interrupted checkpoint');
    return checks;})();`)(bridge, expected, check, later, checks);
};
const entry = path.join(fixture, 'main.cjs'), report = path.join(fixture, 'report.json');
fs.writeFileSync(entry, `const{app,BrowserWindow,session}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});app.whenReady().then(async()=>{const s=session.fromPartition('zhaopin-list-offline');let otherRequests=0;s.protocol.handle('https',request=>{if(request.url!==${JSON.stringify(actual)})otherRequests++;return new Response(${JSON.stringify(markup)},{headers:{'content-type':'text/html; charset=utf-8'}});});const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{session:s,sandbox:true,contextIsolation:true}});try{await w.loadURL(${JSON.stringify(actual)});const checks=await w.webContents.executeJavaScript('('+${JSON.stringify(runChecks.toString())}+')('+${JSON.stringify(JSON.stringify(bridge))}+','+${JSON.stringify(JSON.stringify(setup))}+','+${JSON.stringify(JSON.stringify(expected))}+')');if(otherRequests)throw Error('Unexpected external requests');fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({checks}));}catch(e){fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack}));}finally{w.destroy();app.quit();}});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env, windowsHide: true, timeout: 45000, encoding: 'utf8' });
assert.equal(result.status, 0, result.error?.message || result.stderr);
const outcome = JSON.parse(fs.readFileSync(report, 'utf8')); assert.ok(!outcome.error, outcome.error);
console.log(`PASS Zhaopin list recovery: 9 search-scope checks and ${outcome.checks.length} actual DOM/native-card/collector/CAPTCHA/Stop checks; zero platform requests.`);
