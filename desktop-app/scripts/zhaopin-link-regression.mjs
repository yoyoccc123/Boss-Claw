// Offline: real card extraction in Electron, legacy queue repair, and Camoufox formatting.
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-zhaopin-link-'));
const outfile = join(temporary, 'link.cjs');
await build({ stdin: { contents: "export * from './src/lib/bossclaw/jobDetailLink'; export {makePendingItem,useDataStore} from './src/store/useDataStore';", loader: 'ts', resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile, tsconfig: join(root, 'tsconfig.json'), logLevel: 'silent' });
const { resolveJobDetailUrl, normalizeJobDetailMetadata, repairZhaopinPending, isZhaopinCardFragment, makePendingItem } = require(outfile);
const A = require(join(root, 'electron/preload/platform-adapters.cjs'));
const number = 'CC000100540J41023445004', detail = `https://www.zhaopin.com/jobdetail/${number}.htm`;
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
for (const job of [{ jobId: number }, { jobId: number + '.htm' }, { number }, { positionNumber: number }, { positionUrl: detail }, { positionURL: detail }, { url: `/jobdetail/${number}.htm` }, { url: 'https://www.zhaopin.com/sou/p1', jobId: number }]) {
  check(resolveJobDetailUrl({ ...job, platform: 'zhaopin' }) === detail, 'real public number restores the detail URL');
}
for (const id of ['fpay001', 'fpay002', 'fpay003', 'fad0004', 'fpay005', '123456', '', 'CC12J34/../../sou']) {
  check(resolveJobDetailUrl({ platform: 'zhaopin', jobId: id, url: '' }) === '', 'temporary/invalid numbers never become URLs');
}
check(resolveJobDetailUrl({ platform: 'zhaopin', url: 'https://example.invalid/jobdetail/' + number + '.htm' }) === '', 'foreign links do not become platform details');
check(resolveJobDetailUrl({ platform: 'liepin', url: 'https://www.liepin.com/job/123.shtml' }).includes('liepin.com'), 'other platforms unchanged');
for (const title of ['120-200元/天', '8000-13000元', '15-20K']) check(isZhaopinCardFragment({ platform: 'zhaopin', title }), 'salary fragments excluded');
check(isZhaopinCardFragment({ platform: 'zhaopin', title: '视频Caption 主流行业月薪7-9k' }), 'ad without company or platform identity excluded');
check(!isZhaopinCardFragment({ platform: 'zhaopin', title: 'Python开发实习生', company: '示例公司', jobId: number }), 'real position remains');
const original = [
  { id: 'bad', status: 'approved_queue', job: { platform: 'zhaopin', title: '120-200元/天', jobId: 'fpay001', url: '' }, deliveryGreeting: 'kept', createdAt: 1 },
  { id: 'number', status: 'approved_queue', job: { platform: 'zhaopin', title: '开发实习生', jobId: number, url: '' }, deliveryGreeting: 'kept', createdAt: 1 },
  { id: 'sent', status: 'sent', job: { platform: 'zhaopin', jobId: 'flegacy', url: '' }, deliveryGreeting: 'kept', sentAt: 1, createdAt: 1 },
  { id: 'other', status: 'approved_queue', job: { platform: 'boss', url: 'https://www.zhipin.com/job_detail/one.html' }, deliveryGreeting: 'kept', createdAt: 1 },
];
const repaired = repairZhaopinPending(original);
check(repaired.length === original.length && original[0].status === 'approved_queue', 'repair retains records and never mutates the source');
check(repaired[0].status === 'failed' && repaired[0].linkIncomplete && !repaired[0].retryable, 'unresolvable card leaves sending queue');
check(repaired[1].status === 'approved_queue' && repaired[1].job.url === detail, 'real number remains ready with restored URL');
check(repaired[2] === original[2] && repaired[3] === original[3], 'sent history and other platforms unchanged');
check(repaired.filter(p => p.status === 'approved_queue').map(p => p.id).join(',') === 'number,other', 'bad record does not block remaining queue');
check(JSON.stringify(repairZhaopinPending(repaired)) === JSON.stringify(repaired), 'repair is idempotent');
check(makePendingItem({ platform: 'zhaopin', jobId: number }, { greeting: 'hello' }, 'hello', 'new').job.url === detail, 'manual/task creation uses the same restoration');
check(normalizeJobDetailMetadata({ platform: 'boss', url: 'one' }).url === 'one', 'normalization stays platform-scoped');
check(A.zhaopinJobPageUrl(number) === detail && A.zhaopinJobPageUrl('fpay001') === '', 'preload URL parser agrees');

// Extract the production functions with the TypeScript parser, without starting the preload or engines.
const source = ts.createSourceFile('webview.cjs', readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true);
const functions = new Map(), constants = new Map();
const visit = node => { if (ts.isFunctionDeclaration(node) && node.name && !functions.has(node.name.text)) functions.set(node.name.text, node.getText(source)); if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !constants.has(node.name.text)) constants.set(node.name.text, node.initializer.getText(source)); ts.forEachChild(node, visit); };
visit(source);
const functionNames = ['visible', 'textOf', 'rawLines', 'pickFromCard', 'zhaopinTitleFromCard', 'cardIdentity', 'cardJobTokens', 'collectCards'];
functionNames.forEach(name => assert.ok(functions.has(name), name));
const body = `<style>.job-card,.joblist-box__item{padding:10px;margin:4px;min-height:30px}.job-card__body{padding:4px}</style>
<div class="job-list-panel">
<div class="job-card" data-case="full" data-bossclaw-jobdetail="${detail}"><div class="job-card__title-main"><span class="vue-clamp__text" aria-label="Python开发实习生">Python开发实习生</span></div><div class="job-card__body"><span class="job-card__salary">120-200元/天</span><div class="job-card__company-name">示例公司</div><div>${'真实岗位补充说明'.repeat(150)}</div></div></div>
<div class="job-card" data-case="aria" data-bossclaw-jobdetail="${detail}"><div class="job-card__title-main" aria-label="AI应用开发实习生"></div><span class="job-card__salary">250-350元/天</span><div class="job-card__company-name">另一公司</div></div>
<div class="job-card" data-case="child-aria" data-bossclaw-jobdetail="${detail}"><div class="job-card__title-main"><span class="vue-clamp__text" aria-label="视觉开发实习生"></span></div><span class="job-card__salary">180-220元/天</span><div class="job-card__company-name">视觉公司</div></div>
<div class="job-card" data-case="loading"><span class="job-card__salary">140-160元/天</span><div class="job-card__company-name">加载中公司</div></div>
<div class="job-card" data-case="salary-title"><div class="job-card__title-main">8000-13000元</div><div class="job-card__company-name">错误片段公司</div></div>
<div class="job-card__ad" data-case="ad">视频Caption 主流行业月薪7-9k</div>
<div class="job-card" data-case="unknown-link"><div class="job-card__title-main">后端开发实习生</div><span class="job-card__salary">150-200元/天</span><div class="job-card__company-name">公开岗位公司</div></div>
</div>
<div class="joblist-box__item" data-case="legacy"><a class="jobinfo__name" href="${detail}">旧版开发实习生</a><span class="jobinfo__salary">200元/天</span><a class="companyinfo__name">旧版公司</a></div>`;
const code = `(()=>{const ADAPTERS=${JSON.stringify({ PLATFORM_CARD_SELECTORS: A.PLATFORM_CARD_SELECTORS, PLATFORM_CARD_CONTAINER_SELECTOR: A.PLATFORM_CARD_CONTAINER_SELECTOR })}; ADAPTERS.jobIdFromUrl=${A.jobIdFromUrl.toString()};const PLATFORM='zhaopin',PLATFORM_LIST_SELECTORS=ADAPTERS.PLATFORM_CARD_SELECTORS,FIELD_SELECTORS=${JSON.stringify(A.PLATFORM_FIELD_SELECTORS.zhaopin)},LINK_SELECTOR=${JSON.stringify(A.PLATFORM_LINK_SELECTOR.zhaopin)};
const all=(selector,scope=document)=>Array.from(scope.querySelectorAll(selector)),first=(selector,scope=document)=>scope?.querySelector(selector),notify=()=>{},cleanCompanyName=s=>String(s||''),looksLikeLocation=()=>false;
${['CARD_LINE_NOISE','SALARY_LINE_RE','SALARY_TEXT_RE','SALARY_WHOLE_RE'].map(name => `const ${name}=${constants.get(name)};`).join('\n')}
${functionNames.map(name => functions.get(name)).join('\n')}
const cards=collectCards(true);return {cases:cards.map(c=>c.getAttribute('data-case')),titles:cards.map(c=>cardIdentity(c).title),oldSelectorCount:document.querySelectorAll('[class*="job-card"]').length,actualCardCount:cards.length};})()`;
const html = join(temporary, 'cards.html'), entry = join(temporary, 'main.cjs'), reportPath = join(temporary, 'report.json');
writeFileSync(html, '<meta charset="utf-8">' + body);
writeFileSync(entry, `const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});app.setPath('sessionData',${JSON.stringify(join(temporary, 'profile'))});app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1100,height:1800,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));try{await w.loadFile(${JSON.stringify(html)});const result=await w.webContents.executeJavaScript(${JSON.stringify(code)});fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify(result));}catch(e){fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:e.stack}));}finally{w.destroy();app.quit();}});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const processResult = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env, windowsHide: true, timeout: 30000, encoding: 'utf8' });
assert.equal(processResult.status, 0, processResult.error?.message || processResult.stderr);
const report = JSON.parse(readFileSync(reportPath, 'utf8')); assert.ok(!report.error, report.error);
check(report.cases.join(',') === 'full,aria,child-aria,unknown-link,legacy', 'real DOM: one card each, no salary/content/ad fragments');
check(report.titles.join(',') === 'Python开发实习生,AI应用开发实习生,视觉开发实习生,后端开发实习生,旧版开发实习生', 'real DOM: nested title aria-label and old/new layouts preserved');
check(report.oldSelectorCount > report.actualCardCount * 2, 'fixture exercises broad-selector duplicate bug');
console.log(`PASS zhaopin link: ${checks} checks; real isolated DOM report: ${reportPath}`);

// Execute the production queue dispatcher, substituting only storage and outbound boundaries.
const workbench = ts.createSourceFile('Workbench.tsx', readFileSync(join(root, 'src/pages/Workbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dispatcher, retryAll;
const findDispatcher = node => { if (ts.isVariableDeclaration(node)) { if (node.name.getText(workbench) === 'runNext') dispatcher = node.initializer.getText(workbench); if (node.name.getText(workbench) === 'onRetryAllFailed') retryAll = node.initializer.getText(workbench); } ts.forEachChild(node, findDispatcher); }; findDispatcher(workbench);
assert.ok(dispatcher);
const dispatcherCode = (await transform(`globalThis.dispatch = ${dispatcher}`, { loader: 'ts', target: 'es2022' })).code;
let queue = JSON.parse(JSON.stringify(original)), requested = 0, pauses = 0, allowed = true;
const boundaryCalls = [];
const context = {
  useDataStore: { getState: () => ({ pending: queue }) }, useSettingsStore: { getState: () => ({ config: { executionMode: 'manual', camoufox: { enabled: false } } }) },
  useAppStore: { getState: () => ({ autoAssist: true }) }, rerankPending: p => p, isDeliveryClaimed: () => false,
  visualActiveRef: { current: false }, cfxActiveRef: { current: false }, searchTriggered: { current: false }, lastApplyStageRef: { current: '' },
  setActiveId: () => {}, setApplyStage: () => {}, addLog: () => {}, setRunning: () => {}, setAutoAssist: () => {}, startCollect: () => {},
  resolveJobDetailUrl, isZhaopinCardFragment, ZHAOPIN_LINK_ERROR: 'incomplete detail link',
  updatePending: (id, patch) => { queue = queue.map(p => p.id === id ? { ...p, ...patch } : p); }, recomputeStats: () => {},
  requestRunNext: () => { requested++; }, pauseAssist: () => { pauses++; }, precheckDelivery: () => allowed,
  deliverNonBoss: async (item, url) => { boundaryCalls.push({ id: item.id, url }); }, deliverCamoufox: async () => {}, deliverBossDom: async (item, url) => { boundaryCalls.push({ id: item.id, url }); },
};
vm.runInNewContext(dispatcherCode, context);
await context.dispatch();
check(queue[0].status === 'failed' && requested === 1 && pauses === 0 && boundaryCalls.length === 0, 'actual dispatcher isolates missing-link record without global pause or sending');
await context.dispatch();
check(boundaryCalls.length === 1 && boundaryCalls[0].id === 'number' && boundaryCalls[0].url === detail, 'actual dispatcher can process the next job and restore its public number URL');
queue = [original[3]]; allowed = false; await context.dispatch();
check(boundaryCalls.length === 1, 'actual dispatcher still respects precheck/risk blocking');
allowed = true; queue = [{ ...original[3], job: { platform: 'boss', url: '' } }]; await context.dispatch();
check(pauses === 1, 'non-Zhaopin missing-link behavior unchanged');
console.log('PASS dispatcher: 4 checks on production runNext, outbound boundaries are stubs.');
let starts = 0;
context.pending = [{ ...repaired[0] }, { ...original[3], status: 'failed' }];
context.message = { info: () => {} }; context.setPending = value => { context.pending = value; }; context.startDelivery = () => { starts++; };
vm.runInNewContext((await transform(`globalThis.retryAll = ${retryAll}`, { loader: 'ts' })).code, context);
context.retryAll();
check(context.pending[0].status === 'failed' && context.pending[1].status === 'approved_queue' && starts === 1, 'bulk retry cannot requeue unlinked ghost records');
context.pending = [repaired[0]]; context.retryAll();
check(starts === 1, 'only incomplete records cannot restart delivery');
const autoChat = ts.createSourceFile('useAutoChatStore.ts', readFileSync(join(root, 'src/store/useAutoChatStore.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
let chatJob;
const findChat = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'chatJob') chatJob = node.getText(autoChat); ts.forEachChild(node, findChat); }; findChat(autoChat);
queue = [JSON.parse(JSON.stringify(original[0]))];
context.useRuntimeLogsStore = { getState: () => ({ addLog: () => {}, addChatLog: () => {} }) };
context.useDataStore = { getState: () => ({ updatePending: context.updatePending }) };
context.useSettingsStore = { getState: () => { throw new Error('invalid job reached engine configuration'); } };
vm.runInNewContext((await transform(`${chatJob};globalThis.chatOne=chatJob`, { loader: 'ts' })).code, context);
check(await context.chatOne(queue[0]) === 'failed' && queue[0].linkIncomplete, 'automatic communication rejects a missing Zhaopin target before reaching the engine');
console.log('PASS retry/autochat: 3 checks on production functions, no engine or network.');

const pythonPath = join(temporary, 'format_test.py');
writeFileSync(pythonPath, `import ast,re,sys,importlib.util\nfrom pathlib import Path\nfrom urllib.parse import urlparse\nroot=Path(${JSON.stringify(root)})\nmodel=root/'camoufox/platforms/models.py'\nspec=importlib.util.spec_from_file_location('isolated_fixture_models',model)\nmodule=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)\ntree=ast.parse((root/'camoufox/platforms/zhaopin.py').read_text(encoding='utf-8-sig'))\nfn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='format_jobs')\nnamespace={'JobCandidate':module.JobCandidate,'PLATFORM':'zhaopin','re':re,'urlparse':urlparse}\nexec(compile(ast.Module(body=[fn],type_ignores=[]),'format_jobs','exec'),namespace)\nf=namespace['format_jobs'];number='${number}';expected='${detail}'\nfor item in [{'number':number},{'number':number,'positionURL':'https://www.zhaopin.com/sou/p1'},{'jobId':number+'.htm'}]:\n assert f([item])[0].url==expected\nassert f([{'jobId':'fpay001'}])[0].url==''\nassert f([{'number':number,'positionUrl':expected+'?source=list'}])[0].url==expected+'?source=list'\nassert f([{}])==[]\nprint('PASS Camoufox: 6 offline formatting cases; no engine imports or network.')\n`);
const py = spawnSync(process.env.BOSSCLAW_PYTHON || 'python', [pythonPath], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
assert.equal(py.status, 0, py.error?.message || py.stderr); console.log(py.stdout.trim());
