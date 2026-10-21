// Offline real DOM + production host functions. Never contact a recruitment website.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build, transform } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url),root=dirname(dirname(fileURLToPath(import.meta.url))),work=mkdtempSync(join(tmpdir(),'bossclaw-zhaopin-block-'));
const A=require(join(root,'electron/preload/platform-adapters.cjs'));
const {readBossPageBlock}=require(join(root,'electron/preload/boss-page-block.cjs'));
const imHelper=readFileSync(join(root,'electron/preload/zhaopin-im.cjs'),'utf8');
function parse(file) {
  const source=ts.createSourceFile(file,readFileSync(join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=new Map(),vars=new Map();
  const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(source));if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)vars.set(node.name.text,node.initializer.getText(source));ts.forEachChild(node,visit);};visit(source);return{functions,vars};
}
const preload=parse('electron/preload/webview.cjs'),wb=parse('src/pages/Workbench.tsx'),browser=parse('src/components/BrowserView.tsx');
const normal='<div class="summary-planes__action"><button id="apply">立即投递</button></div><div class="job-description">职位描述：Python开发实习</div>';
// Captured native offline structure; all content and identifiers are synthetic.
const offline='<div class="summary-planes"><h1 class="summary-planes__title">示例岗位</h1><div class="summary-planes__other"><img class="summary-planes__invalid-text" src="https://example.invalid/assets/ic-offline.fixture.png" width="180" height="60"></div><a>查看更多相似职位</a></div>';
const challenge='<div class="geetest_panel" style="width:300px;height:180px">请拖动滑块完成人机验证</div>';
const success="document.body.insertAdjacentHTML('beforeend','<div class=\"a-job-apply-success-message-panel\">简历投递成功</div>');";
const attachmentPanel=(selected='online',extra='')=>`<div class="a-attachment-select"><div class="a-attachment-select__item ${selected==='online'?'resume-select':''}" id="online"><span class="file-online"></span>在线简历</div><div class="a-attachment-select__item ${selected==='attachment'?'resume-select':''}" id="attachment"><span class="file-pdf"></span>示例姓名.pdf</div>${extra}<a class="a-attachment-select__action-btn__delivery">投递简历</a></div>`;
const attachmentAfter=panel=>`if(el.id==='apply')document.body.insertAdjacentHTML('beforeend',${JSON.stringify(panel)});else if(el.matches('.a-attachment-select__item')){document.querySelectorAll('.resume-select').forEach(e=>e.classList.remove('resume-select'));el.classList.add('resume-select');}else if(el.matches('.a-attachment-select__action-btn__delivery')){if(!document.querySelector('#attachment.resume-select'))throw Error('Online resume must never be submitted');${success}}`;
const cases=[
  {name:'官方下线图片跳过而非暂停',html:offline,stage:'skip',entry:'unavailable',clicks:0},
  {name:'下线页安全验证仍优先暂停',html:offline+challenge,stage:'risk',entry:'risk',clicks:0},
  {name:'隐藏旧下线标记不误跳过',html:normal+'<div style="display:none">'+offline+'</div>',after:success,stage:'success',entry:'ready',clicks:1},
  {name:'下线标记与可用入口冲突保留核对',html:normal+offline,stage:'failed',review:true,entry:'missing',clicks:0},
  {name:'下线标记与已投递入口冲突保留核对',html:normal.replace('立即投递','已投递')+offline,stage:'failed',review:true,entry:'missing',clicks:0},
  {name:'其他区域的下线图片不误跳过',html:normal+offline.replace('class="summary-planes"','class="recommendation"'),after:success,stage:'success',entry:'ready',clicks:1},
  {name:'不同区域的标题不能为失效图片背书',html:offline.replace('<h1 class="summary-planes__title">示例岗位</h1>','')+'<h1 class="summary-planes__title">另一岗位</h1>',stage:'failed',review:true,entry:'missing',clicks:0},
  {name:'岗位正文中下线说明不误跳过',html:normal+'<div class="job-description">负责处理职位已下线等状态</div>',after:success,stage:'success',clicks:1},
  {name:'详情外图片不能标记岗位下线',html:offline,href:'https://www.zhaopin.com/',stage:'failed',review:true,entry:'missing',clicks:0},
  {name:'已投递入口状态',html:normal.replace('立即投递','已投递'),stage:'success',entry:'already',clicks:0},
  {name:'继续沟通入口状态',html:normal.replace('立即投递','继续沟通'),stage:'success',entry:'already',clicks:0},
  {name:'详情进入时验证码',html:challenge,stage:'risk',clicks:0},
  {name:'验证遮罩覆盖正常按钮',html:normal+challenge,stage:'risk',clicks:0},
  {name:'验证优先于已投递按钮',html:normal.replace('立即投递','已投递')+challenge,stage:'risk',clicks:0},
  {name:'验证优先于继续沟通',html:normal.replace('立即投递','继续沟通')+challenge,stage:'risk',clicks:0},
  {name:'验证优先于外部网申',html:challenge+'<button>外部申请</button>',external:['外部申请'],stage:'risk',clicks:0},
  {name:'验证URL',html:'<main>加载中</main>',href:'https://www.zhaopin.com/security-check',stage:'risk',clicks:0},
  {name:'WAF路径',html:'<main>加载中</main>',href:'https://www.zhaopin.com/pwaf_challenge',stage:'risk',clicks:0},
  {name:'跨域验证码框架',html:'<iframe style="width:500px;height:300px" src="https://captcha.example.invalid/security-check"></iframe>',stage:'risk',clicks:0},
  {name:'框架安全验证标题',html:'<iframe title="安全验证" style="width:500px;height:300px"></iframe>',stage:'risk',clicks:0},
  {name:'同源验证码框架',html:'<iframe style="width:500px;height:300px" srcdoc="<div class=geetest_panel>请完成人机验证</div>"></iframe>',stage:'risk',clicks:0},
  {name:'独立人机拦截页',html:'<main>请完成安全验证后继续访问</main>',stage:'risk',clicks:0},
  {name:'ARIA安全验证弹层',html:normal+'<div role="dialog">安全验证：请完成验证</div>',stage:'risk',clicks:0},
  {name:'岗位正文业务词不误判',html:normal.replace('Python开发实习','负责验证码、安全验证和行为异常业务接口，任职要求：Python') ,after:success,stage:'success',clicks:1},
  {name:'描述中的业务验证码控件不误判',html:normal.replace('</div>','</div>')+'<div class="job-description"><div class="captcha-example">验证码业务示例</div></div>',after:success,stage:'success',clicks:1},
  {name:'隐藏验证码不误判',html:normal+'<div style="display:none">'+challenge+'</div>',after:success,stage:'success',clicks:1},
  {name:'透明父容器不误判',html:normal+'<div style="opacity:0">'+challenge+'</div>',after:success,stage:'success',clicks:1},
  {name:'空验证码挂载点不误判',html:normal+'<div class="geetest-container" style="width:200px;height:20px"></div>',after:success,stage:'success',clicks:1},
  {name:'无关跨域框架不误判',html:normal+'<iframe style="width:300px;height:200px" src="https://cdn.example.invalid/banner"></iframe>',after:success,stage:'success',clicks:1},
  {name:'短信登录验证码是登录墙',html:'<form class="login-panel">手机登录 短信验证码<input id="captcha" placeholder="验证码"><button>登录</button></form>',stage:'login',clicks:0},
  {name:'短信登录混合安全文案',html:'<div class="a-modal"><form class="login-panel">账号安全验证 手机登录 短信验证码<input id="captcha"><button>登录</button></form></div>',stage:'login',clicks:0},
  {name:'短信弹层没有登录class',html:normal+'<div role="dialog">账号安全验证 短信验证码<input placeholder="验证码"></div>',stage:'login',clicks:0},
  {name:'短信登录仍有人机控件时优先验证',html:'<form class="login-panel">短信验证码<input></form>'+challenge,stage:'risk',clicks:0},
  {name:'同源短信登录框架',html:'<iframe style="width:500px;height:300px" srcdoc="<form class=login-panel>手机登录 短信验证码<input id=captcha></form>"></iframe>',stage:'login',clicks:0},
  {name:'独立扫码登录页',html:'<main>请先登录，使用智联APP扫码登录</main>',stage:'login',clicks:0},
  {name:'隐藏登录表单不误判',html:normal+'<form class="login-panel" style="display:none">登录<input id="captcha"></form>',after:success,stage:'success',clicks:1},
  {name:'可见导航包裹隐藏登录表单不误判',html:normal+'<div class="header-login">登录/注册<form style="display:none"><input placeholder="手机号"></form></div>',after:success,stage:'success',clicks:1},
  {name:'登录弹层中隐藏文字不当可见提示',html:normal+'<div class="a-modal" style="width:300px;height:80px"><div style="display:none">短信验证码 请先登录</div></div>',after:success,stage:'success',clicks:1},
  {name:'聊天初始化导航不当登录墙',html:'<header>首页 职位 消息 登录/注册</header><main>聊天加载中</main>',href:'https://i.zhaopin.com/im?sessionId=fixture',stage:'failed',review:true,entry:'missing',block:null,clicks:0},
  {name:'详情导航不当登录墙',html:'<header>首页 职位 消息 登录/注册</header><main>加载中</main>',stage:'failed',review:true,entry:'missing',block:null,clicks:0},
  {name:'聊天页真实登录表单仍暂停',html:'<form class="login-panel">手机登录 短信验证码<input placeholder="验证码"><button>登录</button></form>',href:'https://i.zhaopin.com/im?sessionId=fixture',stage:'login',block:'login',clicks:0},
  {name:'聊天页真实验证码仍暂停',html:challenge,href:'https://i.zhaopin.com/im?sessionId=fixture',stage:'risk',block:'risk',clicks:0},
  {name:'未知页面保留人工核对',html:'<main>页面尚未加载完成</main>',stage:'failed',review:true,clicks:0},
  {name:'跳回首页保留人工核对',html:'<main>智联招聘 首页<button>搜索</button></main>',stage:'failed',review:true,clicks:0},
  {name:'点击后安全验证停止确认',html:normal,after:"document.body.insertAdjacentHTML('beforeend',"+JSON.stringify(challenge+'<div class="a-job-apply-workflow"><button>确定投递</button></div>')+");",stage:'risk',clicks:1},
  {name:'选择简历正常二次确认',html:normal,after:"if(el.id==='apply')document.body.insertAdjacentHTML('beforeend','<div class=\"a-job-apply-workflow\"><button>确定投递</button></div>');else{"+success+'}',stage:'success',clicks:2},
  {name:'按钮点击结果不明保留',html:normal,stage:'failed',review:true,clicks:1},
  {name:'附件面板默认在线时先选附件',html:normal,after:attachmentAfter(attachmentPanel()),stage:'success',clicks:3},
  {name:'已选附件直接提交附件',html:normal,after:attachmentAfter(attachmentPanel('attachment')),stage:'success',clicks:2},
  {name:'附件未审核不回退在线',html:normal,after:attachmentAfter(attachmentPanel().replace('id="attachment"','id="attachment" aria-disabled="true"')),stage:'failed',review:true,clicks:1},
  {name:'多份附件不随便选一份',html:normal,after:attachmentAfter(attachmentPanel('online','<div class="a-attachment-select__item"><span class="file-doc"></span>另一份.docx</div>')),stage:'failed',review:true,clicks:1},
  {name:'策略拦住平台默认在线',html:normal,policyBlocked:true,stage:'failed',review:true,clicks:1},
  {name:'附件保护未就绪不能点主按钮',html:normal,policyUnavailable:true,stage:'failed',review:true,clicks:0},
  {name:'旧成功提示不能替代附件请求证据',html:normal,after:success,noAttachmentRequest:true,stage:'failed',review:true,clicks:1},
];
const helper=readFileSync(join(root,'electron/preload/zhaopin-page-block.cjs'),'utf8');
const names=['visible','textOf','findPlatformAction','externalApplyDetected','firstVisible','readZhaopinApplyEntry','platformApplyOnce','pageStatusData'];names.forEach(n=>assert.ok(preload.functions.has(n),n));
const fixtureCode=fixture=>`(async()=>{const fixture=${JSON.stringify(fixture)};
const readZhaopinPageBlock=(()=>{const module={exports:{}};${helper};return module.exports.readZhaopinPageBlock;})();
const readBossPageBlock=${readBossPageBlock.toString()};
const ADAPTERS=${JSON.stringify({PLATFORM_APPLY_SPEC:A.PLATFORM_APPLY_SPEC})};ADAPTERS.labelHit=${A.labelHit.toString()};ADAPTERS.labelExactHit=${A.labelExactHit.toString()};ADAPTERS.normLabelText=${A.normLabelText.toString()};ADAPTERS.classifyBlockedText=${A.classifyBlockedText.toString()};
const normLabelText=ADAPTERS.normLabelText,labelHit=ADAPTERS.labelHit,PLATFORM_APPLY_SPEC=ADAPTERS.PLATFORM_APPLY_SPEC;
const PLATFORM='zhaopin',location={href:fixture.href||'https://www.zhaopin.com/jobdetail/CC000000001J000000001.htm'},PLATFORM_NORM=ADAPTERS.normLabelText;
const {readZhaopinChatReady,readZhaopinAttachmentSelection}=(()=>{const module={exports:{}};${imHelper};return module.exports;})();
const ipcRenderer={invoke:async(channel,payload)=>{if(channel!=='jc:zhaopin-attachment-policy')throw Error('Unexpected IPC');if(fixture.policyUnavailable)return{ok:false,message:'fixture guard unavailable'};return{ok:true,blocked:payload.action==='state'&&!!fixture.policyBlocked,allowedRequests:fixture.noAttachmentRequest?0:1,message:fixture.policyBlocked?'已阻止智联在线简历投递':''};}};
const all=(s,scope=document)=>Array.from(scope.querySelectorAll(s)),events=[],clicks=[];
const PLATFORM_LIST_SELECTORS={zhaopin:[]},LINK_SELECTOR='a',LIST_ROOT_SELECTORS=['.fixture-list'],$=s=>document.querySelector(s),collectCards=()=>[],loginWallDetected=()=>false;
const notify=(channel,payload)=>events.push({channel,payload});
const jitterDelay=async()=>{},waitFor=async fn=>{for(let i=0;i<4;i++){const value=await fn();if(value)return value;}return null;};
const clickElement=async el=>{clicks.push(el.textContent.trim());${fixture.after||''}};
${names.map(n=>preload.functions.get(n)).join('\n')}
const before=pageStatusData();await platformApplyOnce({seq:'case',platform:'zhaopin',externalApplyHints:fixture.external||[]});
const probe=pageStatusData();return {name:fixture.name,result:events.find(e=>e.channel==='platform-apply-result')?.payload,clicks:clicks.length,entry:before.zhaopinApplyEntry?.kind,probeBlock:probe.applyBlock,bodyLen:probe.bodyLen};})()`;
cases.forEach(fixture=>new vm.Script(fixtureCode(fixture)));
const entry=join(work,'main.cjs'),reportFile=join(work,'dom-report.json');
for(let i=0;i<cases.length;i++)writeFileSync(join(work,'fixture-'+i+'.html'),'<meta charset="utf-8"><style>body{font:16px sans-serif}button,input{min-height:30px}iframe{display:block}</style>'+cases[i].html);
writeFileSync(entry,`const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(work,'profile'))});app.setPath('sessionData',${JSON.stringify(join(work,'profile'))});app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));const reports=[];let code=0;try{const cases=${JSON.stringify(cases)};const scripts=${JSON.stringify(cases.map(fixtureCode))};for(let i=0;i<cases.length;i++){await w.loadFile(${JSON.stringify(work)}+'/fixture-'+i+'.html');reports.push(await w.webContents.executeJavaScript(scripts[i]));}fs.writeFileSync(${JSON.stringify(reportFile)},JSON.stringify(reports));}catch(e){fs.writeFileSync(${JSON.stringify(reportFile)},JSON.stringify({error:e.stack}));code=1;}finally{w.destroy();app.exit(code);}});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const processResult=spawnSync(process.env.BOSSCLAW_ELECTRON||require('electron'),[entry],{env,windowsHide:true,timeout:45000,encoding:'utf8'});
assert.equal(processResult.status,0,processResult.error?.message||processResult.stderr);
const reports=JSON.parse(readFileSync(reportFile,'utf8'));assert.ok(!reports.error,reports.error);
for(let i=0;i<cases.length;i++){const expected=cases[i],actual=reports[i];assert.equal(actual.result?.stage,expected.stage,expected.name);assert.equal(actual.clicks,expected.clicks,expected.name+' click count');assert.equal(Boolean(actual.result?.needsReview),Boolean(expected.review),expected.name+' review flag');if(expected.entry)assert.equal(actual.entry,expected.entry,expected.name+' entry state');if('block' in expected)assert.equal(actual.probeBlock?.kind||null,expected.block,expected.name+' page status block');}
const emptyFrameProbe=reports.find(r=>r.name==='跨域验证码框架');assert.equal(emptyFrameProbe.bodyLen,0);assert.equal(emptyFrameProbe.probeBlock?.kind,'risk');
console.log(`PASS Zhaopin blocks: ${cases.length} real isolated DOM workflows; ${reportFile}`);

// Production host: preserve the verification tab and prevent the next job, including a stale activeId.
const bundle=join(work,'safety.cjs');await build({stdin:{contents:"export * from './src/lib/bossclaw/safety';",loader:'ts',resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:bundle,tsconfig:join(root,'tsconfig.json'),logLevel:'silent'});
const safety=require(bundle);
let hostChecks=0;
for(const result of [{ok:false,stage:'risk',code:35,message:'人机验证',tabId:'verify'},{ok:false,stage:'login',message:'扫码登录',tabId:'verify'},{ok:false,stage:'failed',needsReview:true,error:'入口无法确认',tabId:'verify'},{ok:false,stage:'skip',message:'岗位已下线',tabId:'verify'}]) {
  const item={id:'actual-job',status:'approved_queue',deliveryNeedsReview:true,job:{platform:'zhaopin',title:'测试岗位'},deliveryGreeting:'测试岗位用的完整招呼语'},following={id:'next-job',status:'approved_queue'};
  const pending=[item,following],closed=[],pauses=[],state={autoAssist:true};let scheduled=0;
  const c={Promise,useCallback:fn=>fn,activeId:null,deliveryEpochRef:{current:0},deliverySubmittedRef:{current:false},
    useAppStore:{getState:()=>state},useDataStore:{getState:()=>({pending})},useSettingsStore:{getState:()=>({config:{}})},
    updatePending:(id,patch)=>Object.assign(pending.find(p=>p.id===id),patch),awaitDeliveryGap:async()=>true,
    claimDelivery:()=>true,releaseDelivery:()=>{},platformLabel:p=>p,addLog:()=>{},setApplyStage:()=>{},recomputeStats:()=>{},
    pauseAssist:message=>{pauses.push(message);state.autoAssist=false;},requestRunNext:()=>{scheduled++;},
    webviewApi:{current:{platformApply:async()=>result,closeTab:id=>closed.push(id)}},
    classifyRiskCode:safety.classifyRiskCode,resolveCooldownMs:safety.resolveCooldownMs};
  vm.createContext(c);
  for(const name of ['canContinueDelivery','handleRisk','deliverNonBoss'])vm.runInContext((await transform(`globalThis.${name}=${wb.vars.get(name)};`,{loader:'tsx'})).code,c);
  await c.deliverNonBoss(item,'https://example.invalid/job');
  const skipped=result.stage==='skip';
  assert.equal(closed.length,skipped?1:0);assert.equal(pauses.length,skipped?0:1);assert.equal(scheduled,skipped?1:0);assert.equal(item.deliveryNeedsReview,!skipped);assert.equal(item.status,skipped?'skipped':'failed');assert.equal(following.status,'approved_queue');hostChecks++;
}
// A verification iframe can have zero body text: the page probe still blocks without platform IPC.
{
  let dispatched=0;const closed=[];
  const c={Promise,Date,setTimeout,clearTimeout,useCallback:fn=>fn,openInNewTab:()=> 'verify',hasTab:()=>true,closeTabById:id=>closed.push(id),
    PLATFORM_META:{zhaopin:{label:'智联'}},aliveRef:{current:true},APPLY_PAGE_READY_MS:30000,sleep:async()=>{},isPreloadReady:()=>false,isLoading:()=>true,
    pageStatus:async()=>({readyState:'complete',bodyLen:0,cards:0,applyBlock:{kind:'risk',message:'请完成人机验证'}}),
    seqRef:{current:0},apiResolvers:{current:new Map()},sendInTab:()=>{dispatched++;},describeApplyProbe:()=>''};
  c.cmdOnce=async()=>{throw Error('Blocked frame must not execute a page command');};
  vm.createContext(c);vm.runInContext((await transform(`globalThis.apply=${browser.vars.get('platformApply')};`,{loader:'tsx'})).code,c);
  const result=await c.apply('https://example.invalid','zhaopin',{});
  assert.equal(result.stage,'risk');assert.equal(dispatched,0);assert.equal(closed.length,0);hostChecks++;
}
// Real host readiness loop: no apply IPC while the widget is still mounting.
for(const scenario of ['late-ready','offline','stop-late-ready','stop-offline','late-risk','late-login','unknown']) {
  let tick=0,probes=0,allowed=true,started=0,dispatched=0;const closed=[];
  const entry=scenario.includes('offline')?{kind:'unavailable',message:'岗位已下线'}:{kind:'ready'};
  const c={Promise,Date:{now:()=>tick},setTimeout,clearTimeout,useCallback:fn=>fn,openInNewTab:()=> 'entry',hasTab:()=>true,closeTabById:id=>closed.push(id),
    PLATFORM_META:{zhaopin:{label:'智联'}},aliveRef:{current:true},APPLY_PAGE_READY_MS:1200,sleep:async()=>{tick+=300;},isPreloadReady:()=>true,isLoading:()=>false,
    pageStatus:async()=>{probes++;if(probes===1||scenario==='unknown')return{readyState:'complete',bodyLen:900,zhaopinApplyEntry:{kind:'missing'}};
      if(scenario.startsWith('stop-'))allowed=false;
      return{readyState:'complete',bodyLen:900,zhaopinApplyEntry:entry,...(scenario.startsWith('late-')&&scenario!=='late-ready'?{applyBlock:{kind:scenario.slice(5),message:'人工处理'}}:{})};},
    seqRef:{current:0},apiResolvers:{current:new Map()},sendInTab:(_id,_channel,args)=>{dispatched++;Promise.resolve().then(()=>c.apiResolvers.current.get(args.seq)({ok:true,stage:'success'}));},describeApplyProbe:()=>'',cmdOnce:()=>{throw Error('Unexpected confirmation');}};
  vm.createContext(c);vm.runInContext((await transform(`globalThis.apply=${browser.vars.get('platformApply')};`,{loader:'tsx'})).code,c);
  const result=await c.apply('https://example.invalid','zhaopin',{},'',{canStart:()=>allowed,onStart:()=>{started++;}});
  const expected=scenario==='late-ready'?'success':scenario.startsWith('stop-')?'cancelled':scenario==='offline'?'skip':scenario==='unknown'?'failed':scenario.slice(5);
  assert.equal(result.stage,expected,scenario);assert.ok(probes>=2,scenario+' must await the action probe despite ready preload');
  assert.equal(dispatched,scenario==='late-ready'?1:0,scenario+' outbound count');assert.equal(started,dispatched,scenario+' submission boundary');
  assert.equal(closed.length,scenario.startsWith('stop-')?1:0,scenario+' tab preservation');
  if(scenario==='unknown')assert.equal(result.needsReview,true);hostChecks++;
}
console.log(`PASS Zhaopin blocks host: ${hostChecks} production-function pause/preserve/queue checks; outbound boundaries are stubs.`);
