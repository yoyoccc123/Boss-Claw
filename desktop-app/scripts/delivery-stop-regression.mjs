// Execute production host functions with fake storage/browser boundaries; never load a platform.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
function parse(file) {
  const source=ts.createSourceFile(file,readFileSync(join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const vars=new Map(),effects=[];
  const visit=node=>{
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)vars.set(node.name.text,node.initializer.getText(source));
    if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect')effects.push(node.arguments[0].getText(source));
    ts.forEachChild(node,visit);
  };visit(source);return {vars,effects};
}
const wb=parse('src/pages/Workbench.tsx'),browser=parse('src/components/BrowserView.tsx');
const code=async name=>(await transform(`globalThis.${name}=${wb.vars.get(name)};`,{loader:'tsx'})).code;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
let checks=0;const check=(test,name)=>{assert.ok(test,name);checks++;};
const subscription=wb.effects.find(s=>s.includes('useAppStore.subscribe')&&s.includes('deliveryEpochRef'));
assert.ok(subscription);
async function environment(platform='zhaopin') {
  let listener;
  const item={id:'one',status:'approved_queue',job:{platform,title:'测试岗位',url:'https://example.invalid/jobdetail/one'},deliveryGreeting:'测试岗位需要发送的招呼文字',analysis:{}};
  const pending=[item],state={autoAssist:true};
  const gap=deferred(),sent=[],delivered=[],released=[],closed=[];
  const c={Promise,Date,setTimeout,clearTimeout,console,
    deliveryEpochRef:{current:0},deliverySubmittedRef:{current:false},domWaitRef:{current:null},activeTabRef:{current:null},runNextQueued:{current:true},
    useAppStore:{getState:()=>state,subscribe:fn=>{listener=fn;return()=>{};}},
    useDataStore:{getState:()=>({pending,greetings:[]})},
    useSettingsStore:{getState:()=>({config:{camoufox:{enabled:true,prefer:true,os:'windows'},commStuckTimeoutSec:30}})},
    updatePending:()=>{throw new Error('Cancelled work must not mutate queue state');},
    setActiveId:id=>{c.activeId=id;},activeId:'one',setApplyStage:stage=>{c.applyStage=stage;},applyStage:'queued',
    recomputeStats:()=>{},addLog:()=>{},pauseAssist:()=>{},claimDelivery:()=>true,releaseDelivery:id=>released.push(id),
    platformLabel:p=>p,awaitBossBrowseForDelivery:async()=>true,awaitDeliveryGap:()=>gap.promise,requestRunNext:()=>{throw new Error('Stopped work must not schedule another job');},
    handleDelivered:id=>delivered.push(id),extractEncryptJobId:()=> 'one',camoufoxStatus:async()=>({ready:true}),
    camoufoxSend:async()=>{sent.push('camoufox');return{ok:true,sent:true};},
    sleep:async()=>{await flush();},
    webviewApi:{current:{openInNewTab:()=> 'detail',closeTab:id=>closed.push(id),isPreloadReady:()=>true,isLoading:()=>false,
      pageStatus:async()=>({url:'https://example.invalid/detail'}),sendInTab:()=>sent.push('boss'),
      platformApply:async(...args)=>{args[4]?.onStart();sent.push('platform');return{ok:true,stage:'success',tabId:'detail'};}}},
  };
  vm.createContext(c);
  for(const name of ['canContinueDelivery','deliverNonBoss','deliverCamoufox','deliverBossDom','handleApplyStage','onRetryAllFailed','onRetry','onConfirmDelivered'])vm.runInContext(await code(name),c);
  vm.runInContext((await transform(`(${subscription})();`,{loader:'tsx'})).code,c);
  const stop=()=>{const previous={...state};state.autoAssist=false;listener(state,previous);};
  const restart=()=>{const previous={...state};state.autoAssist=true;listener(state,previous);};
  return {c,item,pending,gap,sent,delivered,released,closed,stop,restart};
}
for(const name of ['deliverNonBoss','deliverCamoufox','deliverBossDom']) {
  const env=await environment(name==='deliverNonBoss'?'zhaopin':'boss');
  const run=env.c[name](env.item,env.item.job.url);await flush();env.stop();
  check(env.c.activeId===null&&env.c.applyStage===null,'stopping an unsent task clears active UI immediately');
  env.gap.resolve(true);await run;await flush();
  check(env.sent.length===0,`${name}: stopping in the gap prevents outbound dispatch`);
  check(env.item.status==='approved_queue'&&env.released.length===1,`${name}: queue retained and claim released`);
}
{
  const env=await environment();const run=env.c.deliverNonBoss(env.item,env.item.job.url);env.stop();env.restart();env.gap.resolve(true);await run;
  check(env.sent.length===0,'stop/restart cannot revive a stale waiting task');
}
{
  const env=await environment('boss');const run=env.c.deliverBossDom(env.item,env.item.job.url);env.gap.resolve(true);
  while(!env.sent.length)await flush();env.stop();
  check(env.c.activeId==='one'&&env.c.domWaitRef.current,'an already dispatched request keeps its target and result resolver');
  env.c.handleApplyStage('verify_result',{},'detail');await run;await flush();
  check(env.delivered.join(',')==='one','BOSS success arriving after stop is recorded exactly once');
  check(env.sent.length===1,'stopped BOSS task never resends on navigation');
}
{
  const env=await environment();const terminal=deferred();
  env.c.webviewApi.current.platformApply=async(...args)=>{args[4].onStart();env.sent.push('platform');return terminal.promise;};
  const run=env.c.deliverNonBoss(env.item,env.item.job.url);env.gap.resolve(true);while(!env.sent.length)await flush();env.stop();
  terminal.resolve({ok:true,stage:'success',tabId:'detail'});await run;
  check(env.delivered.join(',')==='one','platform receipt after stop remains associated with the job');
}
// Real BrowserView platformApply: stopping during preload/probe never sends the platform IPC.
const browserApply=browser.vars.get('platformApply');assert.ok(browserApply);
async function browserEnvironment({ready=false}={}) {
  let allowed=true;const pause=deferred(),probe=deferred(),sends=[],closed=[];
  const c={Promise,Date,setTimeout,clearTimeout,useCallback:fn=>fn,PLATFORM_META:{zhaopin:{label:'智联'}},
    openInNewTab:()=> 'detail',hasTab:()=>true,closeTabById:id=>closed.push(id),aliveRef:{current:true},APPLY_PAGE_READY_MS:30000,
    isPreloadReady:()=>ready,isLoading:()=>false,pageStatus:()=>ready?Promise.resolve({readyState:'complete',bodyLen:300,zhaopinApplyEntry:{kind:'ready'}}):probe.promise,sleep:()=>pause.promise,describeApplyProbe:()=>'',
    seqRef:{current:0},apiResolvers:{current:new Map()},reviewTabIdsRef:{current:new Set()},cmdOnce:()=>{throw Error('unexpected confirmation IPC');},sendInTab:(_tab,_channel,arg)=>sends.push(arg)};
  vm.createContext(c);vm.runInContext((await transform(`globalThis.apply=${browserApply};`,{loader:'tsx'})).code,c);
  const control={canStart:()=>allowed,onStart:()=>{c.started=true;}};
  return {c,control,pause,probe,sends,closed,stop:()=>{allowed=false;}};
}
{
  const env=await browserEnvironment();const run=env.c.apply('https://example.invalid','zhaopin',{},'',env.control);env.stop();env.pause.resolve();const result=await run;
  check(result.stage==='cancelled'&&env.sends.length===0&&env.closed.length===1,'stopping during page loading cancels only the owned detail tab');
}
{
  const env=await browserEnvironment();const run=env.c.apply('https://example.invalid','zhaopin',{},'',env.control);env.pause.resolve();await flush();env.stop();env.probe.resolve({readyState:'complete',bodyLen:300});const result=await run;
  check(result.stage==='cancelled'&&env.sends.length===0,'stop during pageStatus response blocks the ready-path IPC');
}
{
  const env=await browserEnvironment({ready:true});const run=env.c.apply('https://example.invalid','zhaopin',{},'',env.control);env.pause.resolve();while(!env.sends.length)await flush();env.stop();
  env.c.apiResolvers.current.get(env.sends[0].seq)({ok:true,stage:'success'});const result=await run;
  check(result.stage==='success'&&env.c.started&&env.closed.length===0,'submitted platform operation keeps its success receipt after stop');
}
{
  const env=await browserEnvironment({ready:true});let timeout;
  env.c.setTimeout=fn=>{timeout=fn;return 1;};env.c.clearTimeout=()=>{};
  const run=env.c.apply('https://example.invalid','zhaopin',{},'',env.control);env.pause.resolve();while(!env.sends.length)await flush();env.stop();timeout();const result=await run;
  check(result.needsReview&&env.closed.length===0,'platform result timeout after submission requires review and preserves the tab');
  check(env.c.reviewTabIdsRef.current.has('detail'),'timed-out review tab is protected from idle cleanup');
}
// A completed unknown Zhaopin result isolates this job; Stop still wins over advancement.
for(const stopAfter of [false,true]) {
  const env=await environment();const patches=[],logs=[];let next=0;
  env.c.addLog=(_level,message)=>logs.push(message);
  env.c.updatePending=(_id,patch)=>{patches.push(patch);Object.assign(env.item,patch);};
  env.c.requestRunNext=()=>{next++;};
  env.c.webviewApi.current.platformApply=async(...args)=>{args[4].onStart();if(stopAfter)env.stop();return{ok:false,stage:'failed',needsReview:true,reviewScope:'job',tabId:'detail',error:'结果未确认'};};
  const run=env.c.deliverNonBoss(env.item,env.item.job.url);env.gap.resolve(true);await run;
  check(env.item.status==='failed'&&env.item.deliveryNeedsReview&&env.item.retryable===false,'unknown Zhaopin job remains excluded from automatic retries');
  check(next===(stopAfter?0:1)&&env.closed.length===0,'unknown Zhaopin job advances only while running and keeps its owned tab');
  check(logs.some(message=>message==='继续处理下一岗位')===!stopAfter,'Stop cannot be followed by a misleading continuation log');
}
{
  const effect=browser.effects.find(s=>s.includes('idleCloseMinutes')&&s.includes('setInterval'));assert.ok(effect);
  let sweep;const closed=[];
  const c={Date:{now:()=>300000},config0:{autoCloseIdleTabs:true,engineMode:'webview',idleCloseMinutes:1},
    tabsRef:{current:[{id:'main',kind:'main'},{id:'review',kind:'detail'},{id:'old',kind:'detail'}]},activeIdRef:{current:'main'},
    reviewTabIdsRef:{current:new Set(['review'])},lastActivityRef:{current:{main:0,review:0,old:0}},
    closeTab:id=>closed.push(id),setInterval:fn=>{sweep=fn;return 1;},clearInterval:()=>{}};
  vm.createContext(c);vm.runInContext((await transform(`(${effect})();`,{loader:'tsx'})).code,c);sweep();
  check(closed.join(',')==='old','idle cleanup preserves the review tab while reclaiming ordinary old tabs');
}
{
  const env=await environment();const patches=[];env.c.updatePending=(_id,patch)=>patches.push(patch);
  env.c.webviewApi.current.platformApply=async(...args)=>{args[4].onStart();env.stop();return{ok:false,stage:'failed',needsReview:true,error:'uncertain'};};
  const run=env.c.deliverNonBoss(env.item,env.item.job.url);env.gap.resolve(true);await run;
  check(patches[0].deliveryNeedsReview&&patches[0].retryable===false,'unknown submitted result is excluded from automatic retries');
}
{
  const env=await environment('boss');let timeout;const patches=[];env.c.setTimeout=fn=>{timeout=fn;return 1;};env.c.clearTimeout=()=>{};
  env.c.updatePending=(_id,patch)=>patches.push(patch);
  const run=env.c.deliverBossDom(env.item,env.item.job.url);env.gap.resolve(true);while(!env.sent.length)await flush();env.stop();timeout();await run;
  check(patches[0].deliveryNeedsReview&&patches[0].retryable===false,'BOSS missing receipt after submission requires review');
}
{
  const env=await environment();let queued;
  env.c.pending=[{...env.item,id:'unknown',status:'failed',deliveryNeedsReview:true},{...env.item,id:'retry',status:'failed'}];
  env.c.setPending=value=>{queued=value;};env.c.startDelivery=()=>{};env.c.message={info:()=>{}};
  env.c.onRetryAllFailed();
  check(queued[0].status==='failed'&&queued[1].status==='approved_queue','bulk retry retains unconfirmed applications for manual review');
}
// Evaluate the production card mapping and statistics, including 52 queued jobs from the report.
for (const stage of ['failed', 'timeout']) {
  const env = await environment('boss'), patches = [], pauses = [];
  env.c.updatePending = (_id, patch) => { patches.push(patch); Object.assign(env.item, patch); };
  env.c.pauseAssist = msg => pauses.push(msg);
  env.c.requestRunNext = () => { throw Error('Unconfirmed sends must not advance or retry'); };
  const run = env.c.deliverBossDom(env.item, env.item.job.url); env.gap.resolve(true); while (!env.sent.length) await flush();
  env.c.handleApplyStage('send_attempted', { sendAttempted: true }, 'detail');
  if (stage === 'failed') env.c.handleApplyStage('failed', { error: 'receipt delayed', needsReview: true, sendAttempted: true }, 'detail');
  else env.c.domWaitRef.current('timeout', { error: 'receipt timeout' }, 'detail');
  await run;
  check(env.item.deliveryNeedsReview && env.item.retryable === false && env.item.greetingSendAttempted, stage + ': post-send uncertainty preserved as manual review');
  check(env.closed.length === 0 && env.delivered.length === 0 && pauses.length === 1, stage + ': tab retained, paused once, never falsely claims sent');
}
{
  const env = await environment('boss'), patches = [];
  env.c.updatePending = (_id, patch) => patches.push(patch);
  env.c.camoufoxSend = async () => ({ ok: true, sent: true, attachmentWarning: 'attachment panel changed' });
  const run = env.c.deliverCamoufox(env.item); env.gap.resolve(true); await run;
  check(env.delivered.length === 1 && patches[0].attachmentWarning && !patches.some(p => p.status === 'failed'), 'confirmed text with attachment warning stays delivered');
}
{
  const env=await environment('boss'), patches=[], advances=[];
  env.c.updatePending=(_id,patch)=>patches.push(patch);env.c.requestRunNext=()=>advances.push('next');
  const run=env.c.deliverBossDom(env.item,env.item.job.url);env.gap.resolve(true);while(!env.sent.length)await flush();
  env.c.handleApplyStage('skipped',{reason:'HR 已回复，已跳过投递和招呼语发送'},'wrong-tab');
  check(patches.length===0,'another tab cannot skip the active application');
  env.c.handleApplyStage('skipped',{reason:'HR 已回复，已跳过投递和招呼语发送'},'detail');await run;
  check(patches.length===1&&patches[0].status==='skipped'&&patches[0].error.includes('HR 已回复'),'HR reply is stored as skipped, never opened in follow-up');
  check(env.delivered.length===0&&advances.length===1&&env.closed.length===1,'HR reply does not count as a delivery and advances the running queue once');
}
{
  const env = await environment('boss'), dialogs = [];
  Object.assign(env.item, { status: 'failed', deliveryNeedsReview: true });
  env.c.pending = env.pending; env.c.activeId = null; env.c.Modal = { confirm: options => dialogs.push(options) };
  env.c.updatePending = (_id, patch) => Object.assign(env.item, patch);
  env.c.onRetry(env.item.id);
  check(env.item.status === 'failed' && dialogs.length === 1, 'review retry requires explicit check of the platform record');
  env.c.onConfirmDelivered(env.item.id); dialogs.at(-1).onOk();
  check(env.item.status === 'sent' && !env.item.deliveryNeedsReview && env.sent.length === 0, 'manual confirmed success only records the outcome, never sends a message');
  dialogs[0].onOk(); check(env.item.status === 'sent', 'stale retry dialog cannot overwrite a later confirmed success');
}
const st=wb.vars.get('st'),tag=wb.vars.get('STATUS_TAG');assert.ok(st&&tag);
const statusCode=(await transform(`const STATUS_TAG=${tag};globalThis.tag=${st};`,{loader:'tsx'})).code;
for(const [running,active,expected] of [[false,false,'待投递'],[true,false,'排队中'],[true,true,'投递中'],[false,true,'结果核对中']]) {
  const c={p:{id:'one',status:'approved_queue'},autoAssist:running,activeId:active?'one':null,applyStage:active?'open_job':null};vm.runInNewContext(statusCode,c);
  check(c.tag.label===expected,`card label is ${expected}`);
}
const statsCode=(await transform(`globalThis.waiting=${wb.vars.get('statToDeliver')};globalThis.delivering=${wb.vars.get('statDelivering')};`,{loader:'tsx'})).code;
{
  const c = { p: { id: 'review', status: 'failed', deliveryNeedsReview: true }, autoAssist: false, activeId: null, applyStage: null };
  vm.runInNewContext(statusCode,c); check(c.tag.label === '待核对', 'unconfirmed receipts display review instead of failed');
  const c2 = { deliveryTasks: [{ p: c.p }, { p: { status: 'failed' } }, { p: { status: 'sent' } }] };
  vm.runInNewContext((await transform(`globalThis.failed=${wb.vars.get('deliveryFailedCount')};globalThis.review=${wb.vars.get('deliveryReviewCount')};`,{loader:'tsx'})).code,c2);
  check(c2.failed === 1 && c2.review === 1, 'review and genuine failure totals are separate');
}
const stats={deliveryApprovedCount:0,deliveryQueuedCount:52,activeItem:null,applyStage:null};vm.runInNewContext(statsCode,stats);
check(stats.waiting===52&&stats.delivering===0,'52 stopped queue items count as waiting; active deliveries are zero');
console.log(`PASS delivery stop: ${checks} production-function and presentation checks; all outbound boundaries are stubs.`);
await import('./delivery-evidence-regression.mjs');
await import('./workbench-view-regression.mjs');
