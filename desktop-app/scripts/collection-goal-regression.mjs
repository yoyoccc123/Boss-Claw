// Run real collection policies, store actions and host callbacks with in-memory storage and no browser/network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundled = await build({stdin:{contents:[
  "export * from './src/lib/bossclaw/collectionGoal';",
  "export * from './src/lib/bossclaw/autoConfirmation';",
  "export * from './src/lib/bossclaw/platformSelection';",
  "export { DEFAULT_CONFIG } from './src/lib/bossclaw/defaults';",
  "export { useDataStore } from './src/store/useDataStore';",
  "export { applyMigrations } from './src/store/migrations/settingsMigrations';",
  "export { effectiveDailyCapFor } from './src/lib/bossclaw/safety';",
  "export { rerankPending } from './src/lib/bossclaw/priority';",
  "export { resolveJobDetailUrl } from './src/lib/bossclaw/jobDetailLink';",
  "export { platformEnabled, sortedEnabledPlatforms } from './src/lib/bossclaw/platforms';",
].join('\n'),resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
let now=Date.UTC(2026,9,13,4), checks=0;
class Clock extends Date { static now(){return now;} }
const memory=new Map(), storeTimers=new Map();
const context={module:{exports:{}},console,Date:Clock,process:{env:{NODE_ENV:'production'}},
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
  setTimeout:(fn)=>{const id=storeTimers.size+1;storeTimers.set(id,fn);return id;},clearTimeout:id=>storeTimers.delete(id),
  fetch:()=>{throw Error('Network is forbidden in this regression');}};
vm.createContext(context);vm.runInContext(bundled.outputFiles[0].text,context);
const T=context.module.exports, cfg=structuredClone(T.DEFAULT_CONFIG);
cfg.platforms.boss.pendingTarget=2;cfg.platforms.boss.dailyTarget=50;cfg.executionMode='auto';
const item=(id,patch={})=>({id,createdAt:now,status:'pending',retryCount:0,job:{platform:'boss',jobId:id,title:id,company:'示例公司',url:`https://www.zhipin.com/job_detail/${id}.html`},
  analysis:{score:68,decision:'recommend',hardBlocks:[],greeting:'有Python自动化实践，希望了解这个岗位。'},deliveryGreeting:'有Python自动化实践，希望了解这个岗位。',...patch});
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
for(const value of [undefined,null,0,-1,NaN,Infinity,''])check(T.normalizePendingTarget(value)===50,'unset/invalid goal stays finite');
check(T.normalizePendingTarget(1001)===1000,'goal has a finite upper bound');
check(T.normalizePendingTarget(12.9)===12,'goal is integral');
check(T.collectionDay(Date.UTC(2026,9,13,15,59))==='2026-10-13','China day before midnight');
check(T.collectionDay(Date.UTC(2026,9,13,16,0))==='2026-10-14','China day changes at midnight');
const old={...structuredClone(cfg),platforms:{boss:{enabled:true,priority:1,dailyTarget:13}}};
const migrated=T.applyMigrations(old,{current:T.DEFAULT_CONFIG,deepseekMap:{}});
check(migrated.platforms.boss.pendingTarget===13,'old configured value becomes the collection goal');
check(migrated.platforms.boss.dailyTarget===13,'migration preserves the independent delivery limit');
old.platforms.boss.pendingTarget=7;
check(T.applyMigrations(old,{current:T.DEFAULT_CONFIG,deepseekMap:{}}).platforms.boss.pendingTarget===7,'explicit new goal survives rehydration');
old.platforms.boss.dailyTarget=0;delete old.platforms.boss.pendingTarget;
check(T.applyMigrations(old,{current:T.DEFAULT_CONFIG,deepseekMap:{}}).platforms.boss.pendingTarget===50,'old unlimited collection falls back to finite default');
const store=T.useDataStore;
const reset=()=>store.setState({pending:[],collectionCounts:{},resumeVariants:[{id:'python',name:'Python版',text:'原简历'},{id:'ai',name:'AI应用版',text:'原简历2'}]});
reset();check(store.getState().addPendingItem(item('one'),cfg),'first qualified job enters the store');
const simultaneous=await Promise.all(['two','three','four'].map(id=>Promise.resolve().then(()=>store.getState().addPendingItem(item(id),cfg))));
check(simultaneous.filter(Boolean).length===1,'simultaneous completions share exactly one remaining slot');
check(store.getState().pending.length===2,'qualified jobs never exceed the goal');
check(!store.getState().addPendingItem(item('one'),cfg),'duplicate job does not consume a slot');
for(const status of ['approved_queue','sent','ignored','rejected']){
  store.getState().setPending(store.getState().pending.map(p=>({...p,status})));
  check(T.collectionGoal(cfg,store.getState().pending,store.getState().collectionCounts,'boss',now).count===2,'status changes do not reduce the cumulative count');
}
store.getState().setPending([]);
check(T.collectionGoal(cfg,[],store.getState().collectionCounts,'boss',now).reached,'deleting cards does not restart unlimited collection');
cfg.platforms.boss.pendingTarget=3;
check(!store.getState().addPendingItem(item('one'),cfg),'deleted job still deduplicates against the same-day ledger');
check(store.getState().addPendingItem(item('five'),cfg),'raising the goal adds only the new remaining slot');
check(store.getState().resumeVariants.map(v=>v.name).join(',')==='Python版,AI应用版','both resume versions are preserved');
const rehydrated=store.persist.getOptions().merge({pending:[],collectionCounts:structuredClone(store.getState().collectionCounts),resumeVariants:store.getState().resumeVariants},store.getState());
check(T.collectionGoal(cfg,rehydrated.pending,rehydrated.collectionCounts,'boss',now).count===3,'rehydration preserves the cumulative ledger');
const yesterday=now;now=Date.UTC(2026,9,13,16);
check(T.collectionGoal(cfg,[],store.getState().collectionCounts,'boss',now).count===0,'next China day has a fresh budget');
check(store.getState().addPendingItem(item('six'),cfg),'next-day collection can resume');
check(!T.collectionGoal(cfg,store.getState().pending,store.getState().collectionCounts,'liepin',now).reached,'platform goals are independent');
now=yesterday;reset();
const pending=[item('ok'),item('cautious',{analysis:{score:60,decision:'cautious',hardBlocks:[],greeting:'已有自动化开发实践，希望沟通。'}}),
  item('short',{deliveryGreeting:'你好',analysis:{score:80,decision:'recommend',hardBlocks:[],greeting:''}}),item('missing',{job:{platform:'boss',title:'缺少链接'}}),
  item('failed',{error:'分析失败'}),item('old-send',{greetingSendAttempted:true}),item('low',{analysis:{score:40,decision:'cautious',hardBlocks:[]}}),
  item('hard',{analysis:{score:90,decision:'recommend',hardBlocks:['不符合学历要求']}}),item('sent',{status:'sent'})];
const confirmed=T.autoConfirmPending(pending,cfg,now);
check(confirmed.filter(p=>p.status==='approved_queue').map(p=>p.id).join(',')==='ok,cautious','auto confirms qualified matching/cautious jobs at the configured entry threshold');
check(confirmed.find(p=>p.id==='ok').deliveryGreeting===pending[0].deliveryGreeting,'auto confirmation preserves the workbench text');
check(confirmed.find(p=>p.id==='old-send').status==='pending','uncertain previous sends are not auto-retried');
check(confirmed.find(p=>p.id==='sent').status==='sent','delivered jobs are unchanged');
const review={...cfg,executionMode:'review'};
check(T.autoConfirmPending(pending,review)===pending,'manual mode continues to require confirmation');
const disabled=structuredClone(cfg);disabled.platforms.boss.enabled=false;
check(T.autoConfirmPending([item('disabled')],disabled)[0].status==='pending','disabled platforms cannot be auto-confirmed');
const changedCap=structuredClone(cfg);changedCap.platforms.boss.pendingTarget=999;
check(T.effectiveDailyCapFor(changedCap,'boss')===50,'collection goal does not weaken the delivery cap');

const source=ts.createSourceFile('Workbench.tsx',readFileSync(join(root,'src/pages/Workbench.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),vars=new Map();
const visit=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer)vars.set(n.name.text,n.initializer.getText(source));ts.forEachChild(n,visit);};visit(source);
async function host(){
  const timers=new Map(),sent=[],logs=[],app={autoAssist:true}, data={pending:[],collectionCounts:{},setPending(p){this.pending=p;},recomputeStats(){}};
  let timerId=0, searchCount=0, deliveryCount=0;
  const c={...T,Promise,Date:Clock,Math,useCallback:fn=>fn,useDataStore:{getState:()=>data},useSettingsStore:{getState:()=>({config:cfg})},useAppStore:{getState:()=>app},
    webviewApi:{current:{sendInTab:(...args)=>sent.push(args),hasTab:()=>true}},visualTabRef:{current:'tab'},visualActiveRef:{current:true},cfxActiveRef:{current:false},
    collectDoneResolve:{current:null},collectSequenceRef:{current:0},collectAwaitingSeqRef:{current:null},collectBottomTimerRef:{current:null},collectBatchGenerationRef:{current:0},collectTerminalRef:{current:''},collectPhaseRef:{current:'collecting'},collectTimeoutMsRef:{current:0},collectDeadlineRef:{current:0},
    collectingPlatformRef:{current:'boss'},goalLoggedRef:{current:new Set()},visualItemBufRef:{current:{}},visualsRafRef:{current:1},collectListReadyLoggedRef:{current:false},visualLoginBlockedRef:{current:''},
    analysisQueueRef:{current:null},setVisualCollecting:()=>{},setVisualPaused:()=>{},setCfxCollecting:()=>{},setVisualItem:()=>{},
    searchTriggered:{current:false},platformLabel:p=>p,searchPlatforms:['boss'],setRunning:()=>{},setAutoAssist:v=>{app.autoAssist=v;},
    addLog:(...args)=>logs.push(args),ingestJob:async()=>true,isDeliveryClaimed:()=>false,setActiveId:()=>{},setApplyStage:()=>{},deliverySubmittedRef:{current:false},lastApplyStageRef:{current:''},
    startCollect:()=>searchCount++,deliverBossDom:async()=>{deliveryCount++;},deliverResumeOnly:async()=>{deliveryCount++;},
    precheckDelivery:()=>true,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(c);
  for(const name of ['checkCollectionGoal','visualCollectInTab','handleCollectDone','handleCollectProgress','controlCollect','stopAllCollect','runNext']){
    assert.ok(vars.has(name),name);vm.runInContext((await transform(`globalThis.${name}=${vars.get(name)};`,{loader:'tsx'})).code,c);
  }
  return {c,data,app,timers,sent,logs,searches:()=>searchCount,deliveries:()=>deliveryCount};
}
{
  const h=await host();let finished=false;
  const wait=h.c.visualCollectInTab('tab',{}).then(()=>{finished=true;});
  const seq=h.sent[0][2].seq;
  h.c.handleCollectDone({seq:'old'});await Promise.resolve();check(!finished,'stale completion cannot finish the current batch');
  h.c.handleCollectDone({seq});await wait;check(finished&&h.timers.size===0,'matching completion resolves and removes timers');
  let nextFinished=false;const next=h.c.visualCollectInTab('tab',{}).then(()=>{nextFinished=true;});
  h.c.handleCollectDone({seq});await Promise.resolve();check(!nextFinished,'late old completion cannot finish the next batch');
  h.c.controlCollect('stop');await next;check(nextFinished,'manual stop resolves without receiving a preload completion');
}
{
  const h=await host();let finished=false;const wait=h.c.visualCollectInTab('tab',{}).then(()=>{finished=true;});
  const savedNow=now;now=h.c.collectDeadlineRef.current;
  h.c.visualActiveRef.current=false;[...h.timers.values()][0].fn();await wait;now=savedNow;
  check(finished,'fallback timeout still settles when the active flag is already false');
}
{
  const h=await host();const wait=h.c.visualCollectInTab('tab',{}),seq=h.sent[0][2].seq;
  h.c.handleCollectDone({seq:'old',error:'stale page failure'});
  check(!h.logs.length,'stale search errors cannot become the current stop explanation');
  h.c.handleCollectDone({seq,reason:'failed',error:'Synthetic native search scope mismatch'});await wait;
  check(h.c.collectTerminalRef.current==='failed'&&h.logs.some(l=>l[1].includes('Synthetic native search scope mismatch')),'native collection failure is logged with its concrete reason');
  h.c.handleCollectDone({seq,finalized:true});
  check(h.c.collectTerminalRef.current==='failed'&&h.logs.length===1,'a finalizer cannot overwrite or duplicate the original failure');
}
{
  const h=await host();const wait=h.c.visualCollectInTab('tab',{}),seq=h.sent[0][2].seq;
  h.c.handleCollectProgress({seq,phase:'list-bottom',status:'加载完毕'});
  const terminal=[...h.timers.values()].find(t=>t.ms===5000);check(!!terminal,'list-bottom has a short completion fallback');
  terminal.fn();await wait;check(h.logs.some(l=>l[1].includes('未收到结束确认')),'missing completion is reported and the wait finishes');
}
{
  const h=await host();const wait=h.c.visualCollectInTab('tab',{});h.c.stopAllCollect();await wait;
  check(h.c.collectBatchGenerationRef.current===1&&h.c.searchTriggered.current,'stop invalidates the batch and prevents automatic restart');
  check(h.app.autoAssist,'stopping collection alone does not interrupt approved deliveries');
}
{
  const h=await host();h.c.visualActiveRef.current=false;h.c.collectingPlatformRef.current=null;
  h.data.pending=[item('deliver')];await h.c.runNext();
  check(h.deliveries()===1&&h.searches()===0,'real runNext confirms an existing eligible pending job before searching');
  h.data.pending=[];h.data.collectionCounts={boss:{date:T.collectionDay(now),count:cfg.platforms.boss.pendingTarget}};
  await h.c.runNext();check(h.searches()===0&&!h.app.autoAssist,'when goal is reached and queue is empty the engine ends without starting another search');
}
{
  const h=await host();h.app.autoAssist=false;h.data.pending=[item('stopped')];await h.c.runNext();
  check(h.deliveries()===0&&h.searches()===0&&h.data.pending[0].status==='pending','stopped engine dispatches no collection or delivery');
}
const preloadSource=ts.createSourceFile('webview.cjs',readFileSync(join(root,'electron/preload/webview.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=new Map();let ipcHandler;
const visitPreload=n=>{if(ts.isFunctionDeclaration(n)&&n.name)functions.set(n.name.text,n.getText(preloadSource));if(ts.isCallExpression(n)&&n.expression.getText(preloadSource)==='ipcRenderer.on'&&n.arguments[0]?.text==='visual-collect')ipcHandler=n.arguments[1].getText(preloadSource);ts.forEachChild(n,visitPreload);};visitPreload(preloadSource);
for(const scenario of ['bottom','login','error']){
  const events=[],p={Date:Clock,Math,Set,PLATFORM:'boss',ADAPTERS:{supportsInlineDetail:()=>false},collectCtl:{},document:{body:{innerText:''}},location:{href:'https://www.zhipin.com/web/geek/jobs'},
    notify:(channel,data)=>events.push({channel,data}),collectNotify:(channel,data)=>events.push({channel,data}),resetJdFillState:()=>{},reportJdFillSummary:()=>{},
    collectCards:()=>scenario==='login'?[]:[{}],loginWallDetected:()=>scenario==='login',waitWhilePaused:async()=>{},collectCardKey:()=> 'card',
    cardIdentity:()=>({title:'示例岗位',company:'示例公司'}),smoothScrollIntoView:async()=>{},highlightElement:()=>{},sleep:async()=>{},enrichJobDetail:async()=>{},
    scrollJobListLoadMore:async()=>({grew:false,atBottom:true}),extractJobFromCardOnly:()=>{if(scenario==='error')throw Error('Synthetic extraction failure');return{title:'示例岗位'};}};
  vm.createContext(p);vm.runInContext(functions.get('collectionListExplicitlyEmpty')+'\n'+functions.get('visualCollectListOnly')+'\n'+functions.get('visualCollect')+'\nglobalThis.handler='+ipcHandler,p);
  p.handler(null,{seq:'real-preload',maxJobs:2});await new Promise(r=>setImmediate(r));
  check(events.filter(e=>e.channel==='collect-done').length>0,'production preload always reports terminal completion, including error/login');
  check(events.every(e=>e.data.seq==='real-preload'),'production progress and completion carry the same batch identifier');
  if(scenario==='bottom')check(events.some(e=>e.data.phase==='list-bottom'),'actual bottom-of-list branch is exercised');
}
console.log(`PASS collection goal and auto confirmation: ${checks} policy/store/host/preload checks; in-memory storage, no actual platform calls.`);
