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
    platformLabel:p=>p,awaitDeliveryGap:()=>gap.promise,requestRunNext:()=>{throw new Error('Stopped work must not schedule another job');},
    handleDelivered:id=>delivered.push(id),extractEncryptJobId:()=> 'one',camoufoxStatus:async()=>({ready:true}),
    camoufoxSend:async()=>{sent.push('camoufox');return{ok:true,sent:true};},
    sleep:async()=>{await flush();},
    webviewApi:{current:{openInNewTab:()=> 'detail',closeTab:id=>closed.push(id),isPreloadReady:()=>true,isLoading:()=>false,
      pageStatus:async()=>({url:'https://example.invalid/detail'}),sendInTab:()=>sent.push('boss'),
      platformApply:async(...args)=>{args[4]?.onStart();sent.push('platform');return{ok:true,stage:'success',tabId:'detail'};}}},
  };
  vm.createContext(c);
  for(const name of ['canContinueDelivery','deliverNonBoss','deliverCamoufox','deliverBossDom','handleApplyStage','onRetryAllFailed'])vm.runInContext(await code(name),c);
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
    isPreloadReady:()=>ready,isLoading:()=>false,pageStatus:()=>probe.promise,sleep:()=>pause.promise,describeApplyProbe:()=>'',
    seqRef:{current:0},apiResolvers:{current:new Map()},sendInTab:(_tab,_channel,arg)=>sends.push(arg)};
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
const st=wb.vars.get('st'),tag=wb.vars.get('STATUS_TAG');assert.ok(st&&tag);
const statusCode=(await transform(`const STATUS_TAG=${tag};globalThis.tag=${st};`,{loader:'tsx'})).code;
for(const [running,active,expected] of [[false,false,'待投递'],[true,false,'排队中'],[true,true,'投递中'],[false,true,'结果核对中']]) {
  const c={p:{id:'one',status:'approved_queue'},autoAssist:running,activeId:active?'one':null,applyStage:active?'open_job':null};vm.runInNewContext(statusCode,c);
  check(c.tag.label===expected,`card label is ${expected}`);
}
const statsCode=(await transform(`globalThis.waiting=${wb.vars.get('statToDeliver')};globalThis.delivering=${wb.vars.get('statDelivering')};`,{loader:'tsx'})).code;
const stats={deliveryApprovedCount:0,deliveryQueuedCount:52,activeItem:null,applyStage:null};vm.runInNewContext(statsCode,stats);
check(stats.waiting===52&&stats.delivering===0,'52 stopped queue items count as waiting; active deliveries are zero');
console.log(`PASS delivery stop: ${checks} production-function and presentation checks; all outbound boundaries are stubs.`);
