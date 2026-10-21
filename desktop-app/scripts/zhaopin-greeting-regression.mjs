// Official-template isolated DOM, production preload and host functions. No recruitment network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
const require=createRequire(import.meta.url), root=dirname(dirname(fileURLToPath(import.meta.url))), work=mkdtempSync(join(tmpdir(),'bossclaw-zhaopin-greeting-'));
function parse(file) {
  const source=ts.createSourceFile(file,readFileSync(join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=new Map(),vars=new Map();
  const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name)functions.set(n.name.text,n.getText(source));if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer)vars.set(n.name.text,n.initializer.getText(source));ts.forEachChild(n,visit);};visit(source);return{functions,vars};
}
const preload=parse('electron/preload/webview.cjs'),browser=parse('src/components/BrowserView.tsx'),wb=parse('src/pages/Workbench.tsx');
const helper=readFileSync(join(root,'electron/preload/zhaopin-im.cjs'),'utf8'), A=require(join(root,'electron/preload/platform-adapters.cjs'));
const job={platform:'zhaopin',company:'测试科技有限公司',title:'Python开发实习生 【 广州-海珠区 】',url:'https://www.zhaopin.com/jobdetail/ZL000000000J00000000000.htm'};
const greeting='有Python脚本维护经验，熟悉接口数据处理，希望了解贵公司岗位。', platformDefault='您好，我对这个职位很感兴趣，想进一步了解一下。';
const message=(body,{me=true,status='success',extra=''}={})=>`<div class="im-message ${extra}"><div class="im-message__bubble ${me?'im-message__bubble--me':''}"><div class="im-message__bubble-inner">${body}</div></div>${status==='sending'?'<div class="im-message__send-state">发送中</div>':status==='fail'?'<div class="im-message__send-state"><button class="im-message__fail-btn" aria-label="发送失败，点击重发"></button></div>':me?'<div class="im-message__receipt">送达</div>':''}</div>`;
const html=(history='',alter='')=>`<div class="im-session-item is-active"><span class="im-session-item__name">测试招聘者</span><span class="im-session-item__company-name">测试科技有限公司</span><span class="im-session-item__job">Python开发实习生</span></div><div class="im-main-panel"><div class="im-chat-header"><span class="im-chat-header__name">测试招聘者</span><span class="im-chat-header__meta-text">测试科技有限公司</span><span class="im-chat-header__meta-text">招聘经理</span><span class="im-chat-header__job-title">Python开发实习生</span></div><div class="im-main-panel__timeline">${history||'<div class="im-main-panel__tip">暂无消息，打个招呼吧</div>'}</div><textarea class="im-sender__input" placeholder="从这里开启对话…"></textarea><button class="im-sender__send-btn">发送</button></div>${alter}`;
const base={html:html(message(platformDefault)),defaultGreeting:platformDefault,stage:'success',sends:1};
const detail = url => `<a class="im-chat-header__detail" href="${url}">查看详情</a>`;
const linked = content => content.includes('im-chat-header__detail') ? content : content.replace('</div><div class="im-main-panel__timeline">', `${detail(job.url.replace('.htm','.html'))}</div><div class="im-main-panel__timeline">`);
const reportedDefault='您好，我对该职位很感兴趣，请您看下我的简历，如果合适可以随时联系我，谢谢。';
const reportedLayout=linked(html(message(reportedDefault)+message('示例简历.pdf',{extra:'im-message--custom'})))
  .replaceAll('测试科技有限公司','广东测试知识产权').replaceAll('Python开发实习生','AI产品经理')
  .replace('<span class="im-chat-header__job-title">AI产品经理</span>','<div class="im-chat-header__job"><span class="im-chat-header__job-title" title="AI产品经理">AI产品经理</span><span class="im-chat-header__salary">1.5-2万·13薪</span></div>');
const branchLayout=reportedLayout.replaceAll('广东测试知识产权','海湾环球商业服务(广东)').replaceAll('AI产品经理','AI Engineer');
const branchJob={...job,title:'AI Engineer',company:'海湾环球商业服务(广东)有限公司深圳分公司'};
const sharedLayout=linked(html(message(reportedDefault))).replaceAll('ZL000000000J00000000000.html','ZL111111111J11111111111.html');
const shared={...base,html:sharedLayout,defaultGreeting:'',nativeBinding:{ok:true,source:'native-continue',jobNumber:'ZL000000000J00000000000',sessionId:'target'}};
const cases=[
  {...base,name:'平台默认句后补发工作台文本'},
  {...base,name:'无默认消息也可发送',html:html()},
  {...base,name:'动态默认文案按弹窗原文核对',html:html(message('我希望应聘贵公司此岗位，谢谢。')),defaultGreeting:'我希望应聘贵公司此岗位，谢谢。'},
  {...base,name:'同文案已送达不重复',html:html(message(greeting)),stage:'already_sent',sends:0},
  {...base,name:'平台默认之外已有本人沟通',html:html(message('我明天可以参加面试。')),stage:'skip',sends:0},
  {...base,name:'已有HR回复',html:html(message('请问什么时候到岗？',{me:false})),stage:'skip',sends:0},
  {...base,name:'旧投递保留官方默认句兼容',defaultGreeting:''},
  {...base,name:'不能把未知默认句当已确认默认',html:html(message('未能确认来源的历史文案')),defaultGreeting:'',stage:'skip',sends:0},
  {...base,name:'同文案还在发送不能再发',html:html(message(greeting,{status:'sending'})),stage:'skip',sends:0},
  {...base,name:'已有草稿保留',before:"document.querySelector('textarea').value='用户的草稿';",stage:'failed',sends:0},
  {...base,name:'同岗位编号不受采集公司名差异影响',job:{...job,company:'采集到的其他公司名'}},
  {...base,name:'同岗位编号不受采集旧标题影响',job:{...job,title:'采集到的旧岗位标题'}},
  {...base,name:'错误HR不发送',job:{...job,recruiterName:'另一个人'},stage:'failed',sends:0},
  {...base,name:'错误session不发送',sessionId:'other',stage:'failed',sends:0},
  {...base,name:'多个活跃会话不发送',html:html(message(platformDefault),'<div class="im-session-item is-active">另一会话</div>'),stage:'failed',sends:0},
  {...base,name:'多个编辑框不发送',html:html(message(platformDefault),'<textarea class="im-sender__input"></textarea>'),stage:'failed',sends:0},
  {...base,name:'禁用编辑框不发送',before:"document.querySelector('textarea').disabled=true;",stage:'failed',sends:0},
  {...base,name:'禁用发送按钮保留草稿',before:"document.querySelector('button').disabled=true;",stage:'failed',sends:0},
  {...base,name:'文字输入失败不点发送',inputFail:true,stage:'failed',sends:0},
  {...base,name:'乐观气泡发送中不能计成功',sendStatus:'sending',stage:'failed'},
  {...base,name:'空失败按钮不能计成功',sendStatus:'fail',stage:'failed'},
  {...base,name:'只有草稿清空不计成功',noBubble:true,stage:'failed'},
  {...base,name:'无送达标记不能计成功',noReceipt:true,stage:'failed'},
  {...base,name:'填写中出现HR回复停止',afterInput:message('您好，请介绍项目',{me:false}),stage:'failed',sends:0},
  {...base,name:'发送前切换会话停止',changeAfterPrepare:true,stage:'failed',sends:0},
  {...base,name:'验证先于填入',block:true,stage:'risk',sends:0},
  {...base,name:'附件卡不当文字沟通',html:html(message(platformDefault)+message('附件简历.pdf',{extra:'im-message--custom'}))},
  {...base,name:'发送token不能重放',replay:true},
  {...base,name:'原生成功弹窗进入会话',open:true,html:`<div class="deliver-greeting-modal"><p class="deliver-greeting-modal__content-text">${platformDefault}</p><button class="deliver-greeting-modal__btn--primary">继续沟通</button></div>`,stage:'opening'},
  {...base,name:'原生详情继续沟通',open:true,html:'<div class="summary-planes__action"><button>继续沟通</button></div>',stage:'opening'},
  {...base,name:'打开会话前核对详情链接',open:true,job:{...job,url:job.url.replace('00000.htm','11111.htm')},stage:'failed',sends:0},
  {...base,name:'缺少继续沟通不再次投简历',open:true,html:'<button>立即投递</button>',stage:'failed',sends:0},
  {...base,name:'打开会话前验证不点按钮',open:true,block:true,stage:'risk',sends:0},
  {...base,name:'打开会话前空招呼语不点按钮',open:true,short:true,stage:'failed',sends:0},
  {...base,name:'首次历史加载中不能填发',html:html('<div class="im-main-panel__tip">消息加载中…</div>'),stage:'failed',sends:0},
  {...base,name:'历史读取失败不能当空会话',html:html('<div class="im-main-panel__tip">读取失败 <a>重试</a></div>'),stage:'failed',sends:0},
  {...base,name:'加载旧历史时不漏去重',html:html(message(platformDefault)+'<div class="im-main-panel__history-tip is-loading">加载中…</div>'),stage:'failed',sends:0},
  {...base,name:'隐藏历史加载提示不阻断',html:html(message(platformDefault)+'<div style="display:none"><div class="im-main-panel__tip">消息加载中…</div></div>')},
  {...base,name:'准备后重新加载历史停止发送',historyAfterPrepare:true,stage:'failed',sends:0},
  {...base,name:'已有HR面试卡片不再首次招呼',html:html(message('面试邀请',{me:false,extra:'im-message--custom'})),stage:'skip',sends:0},
  {...base,name:'截图中的公司简称和默认招呼',html:reportedLayout,job:{...job,title:'AI产品经理',company:'广东测试知识产权有限公司'},defaultGreeting:''},
  {...base,name:'法律后缀差异需同岗位链接',html:linked(html(message(platformDefault))).replaceAll('测试科技有限公司','测试科技')},
  {...base,name:'简称没有岗位链接仍停止',html:html(message(platformDefault)).replaceAll('测试科技有限公司','测试科技'),noDetails:true,stage:'failed',sends:0},
  {...base,name:'同名岗位但编号不同停止',html:linked(html(message(platformDefault))).replaceAll('ZL000000000J00000000000.html','ZL111111111J11111111111.html'),stage:'failed',sends:0},
  {...base,name:'详情链接域名错误停止',html:linked(html(message(platformDefault))).replace('https://www.zhaopin.com/jobdetail','https://evil.invalid/jobdetail'),stage:'failed',sends:0},
  {...base,name:'公司展示变化以同岗位编号确认',html:linked(html(message(platformDefault))).replaceAll('测试科技有限公司','公司展示名称')},
  {...base,name:'显示简称列表全称且同岗位',html:linked(html(message(platformDefault))).replace('<span class="im-chat-header__meta-text">测试科技有限公司</span>','<span class="im-chat-header__meta-text">测试科技</span>')},
  {...base,name:'默认文案后附实际交流不能忽略',html:html(message(reportedDefault+'我已确认面试时间。')),defaultGreeting:'',stage:'skip',sends:0},
  {...base,name:'发送前详情编号变化停止',html:linked(html(message(platformDefault))),detailAfterPrepare:true,stage:'failed',sends:0},
  {...base,name:'分公司全称与聊天母公司简称同岗位',html:branchLayout,job:branchJob,defaultGreeting:''},
  {...base,name:'同岗位公司全半角括号等价',html:branchLayout.replaceAll('(广东)','（广东）'),job:branchJob,defaultGreeting:''},
  {...base,name:'列表分公司全称与聊天母公司简称',html:branchLayout.replace('<span class="im-session-item__company-name">海湾环球商业服务(广东)</span>',`<span class="im-session-item__company-name">${branchJob.company}</span>`),job:branchJob,defaultGreeting:''},
  {...base,name:'分公司别名没有岗位编号不发送',html:branchLayout.replace(detail(job.url.replace('.htm','.html')),''),noDetails:true,job:branchJob,stage:'failed',sends:0},
  {...base,name:'分公司同名但岗位编号不同不发送',html:branchLayout.replaceAll('ZL000000000J00000000000.html','ZL111111111J11111111111.html'),job:branchJob,stage:'failed',sends:0},
  {...base,name:'同岗位编号不依赖母公司展示名',html:branchLayout.replaceAll('海湾环球商业服务','其他公司展示名'),job:branchJob,defaultGreeting:''},
  {...base,name:'同岗位编号不依赖展示公司地区',html:branchLayout.replaceAll('(广东)','(广西)'),job:branchJob,defaultGreeting:''},
  {...base,name:'同岗位编号不依赖公司后缀写法',html:branchLayout,job:{...branchJob,company:branchJob.company+'其他'},defaultGreeting:''},
  {...base,name:'公司全称精确相等也不能替代岗位编号',html:branchLayout.replaceAll('海湾环球商业服务(广东)',branchJob.company).replace(detail(job.url.replace('.htm','.html')),''),noDetails:true,job:branchJob,stage:'failed',sends:0},
  {...base,name:'同岗位编号可接受目标旧标题',html:branchLayout,job:{...branchJob,title:'旧岗位名称'},defaultGreeting:''},
  {...base,name:'同岗位编号不要求公司标题采集字段',job:{...job,company:'',title:''}},
  {...base,name:'列表公司显示不同仍以岗位编号为准',html:linked(html(message(platformDefault))).replace('<span class="im-session-item__company-name">测试科技有限公司</span>','<span class="im-session-item__company-name">列表展示简称</span>')},
  {...base,name:'列表岗位与聊天岗位尚未同步不发送',html:linked(html(message(platformDefault))).replace('<span class="im-session-item__job">Python开发实习生</span>','<span class="im-session-item__job">其他岗位</span>'),stage:'failed',sends:0},
  {...base,name:'列表招聘方与聊天招聘方尚未同步不发送',html:linked(html(message(platformDefault))).replace('<span class="im-session-item__name">测试招聘者</span>','<span class="im-session-item__name">另一招聘者</span>'),stage:'failed',sends:0},
  {...base,name:'多个聊天详情编号不发送',html:linked(html(message(platformDefault))).replace('</div><div class="im-main-panel__timeline">',`${detail(job.url)}</div><div class="im-main-panel__timeline">`),stage:'failed',sends:0},
  {...base,name:'聊天详情编号隐藏不使用公司名兜底',before:"document.querySelector('.im-chat-header__detail').style.display='none';",stage:'failed',sends:0},
  {...base,name:'详情链接延迟渲染先等待后发送',noDetails:true,delayedDetail:true},
  {...shared,name:'原生CT岗位与HR旧岗位共用会话可补发'},
  {...shared,name:'共享会话需原生入口证明确认',nativeBinding:{ok:false},stage:'failed',sends:0},
  {...shared,name:'原生关联不能用于另一目标岗位',nativeBinding:{...shared.nativeBinding,jobNumber:'ZL222222222J22222222222'},stage:'failed',sends:0},
  {...shared,name:'原生关联不能用于另一会话',nativeBinding:{...shared.nativeBinding,sessionId:'other'},stage:'failed',sends:0},
  {...shared,name:'原生关联过期不能放行',expiredBinding:true,stage:'failed',sends:0},
  {...shared,name:'其他来源的关联不能放行',nativeBinding:{...shared.nativeBinding,source:'untrusted'},stage:'failed',sends:0},
  {...shared,name:'原生共享会话仍核对目标招聘方',job:{...job,recruiterName:'另一招聘方'},stage:'failed',sends:0},
  {...shared,name:'共享会话发送前切换会话停止',changeAfterPrepare:true,stage:'failed',sends:0},
  {...shared,name:'共享会话授权发送前失效停止',bindingRejectedAfterPrepare:true,stage:'failed',sends:0},
  {...shared,name:'同一原生会话的展示岗位变化不阻断',detailAfterPrepare:true},
  {...shared,name:'共享会话已确认同文案不重复',html:sharedLayout.replace(reportedDefault,greeting),stage:'already_sent',sends:0},
  {...shared,name:'共享会话已有真实回复不重复打扰',html:sharedLayout.replace(reportedDefault,'招聘方已回复').replace('im-message__bubble im-message__bubble--me','im-message__bubble'),stage:'skip',sends:0},
  {...shared,name:'只读核对原生共享会话不填写不发送',inspect:true,stage:'identified',sends:0},
  {...base,name:'平台查看简历回执不视为HR真实回复',html:html(message(platformDefault)+message('感谢您的投递，HR正在仔细查看简历',{me:false}))},
  {...base,name:'平台回执波浪号版本不阻断',html:html(message(platformDefault)+message('感谢您的投递，HR正在仔细查看简历~',{me:false}))},
  {...base,name:'回执后附真实面试内容仍是回复',html:html(message(platformDefault)+message('感谢您的投递，HR正在仔细查看简历，请明天来面试',{me:false})),stage:'skip',sends:0},
  {...base,name:'本人文字引用HR回执不能视为默认消息',html:html(message('感谢您的投递，HR正在仔细查看简历')),stage:'skip',sends:0},
  {...shared,name:'实际共享会话默认句回执附件后发工作台文案',html:sharedLayout.replace(message(reportedDefault),message(reportedDefault)+message('感谢您的投递，HR正在仔细查看简历',{me:false})+message('附件.pdf',{extra:'im-message--custom'}))},
];
const names=['visible','textOf','findPlatformAction','firstVisible','zhaopinChatStep'];
const script=c=>`(async()=>{const c=${JSON.stringify(c)},greeting=${JSON.stringify(greeting)};
const {readZhaopinChat,readZhaopinChatReady,readZhaopinDeliveryState,sessionIdFromUrl}=(()=>{const module={exports:{}};${helper};return module.exports;})();
const ADAPTERS=${JSON.stringify({PLATFORM_APPLY_SPEC:A.PLATFORM_APPLY_SPEC})};ADAPTERS.labelHit=${A.labelHit.toString()};ADAPTERS.normLabelText=${A.normLabelText.toString()};const normLabelText=ADAPTERS.normLabelText;
const location={href:c.open?${JSON.stringify(job.url)}:'https://i.zhaopin.com/im?sessionId=target'},PLATFORM_NORM=ADAPTERS.normLabelText;
const all=(s,r=document)=>[...r.querySelectorAll(s)],readZhaopinPageBlock=()=>c.block?{kind:'risk',message:'人工验证'}:null;
let zhaopinPrepared=null,sends=0;const waitFor=async fn=>{for(let i=0;i<4;i++){const r=await fn();if(r)return r;}return null;};
let verifyCalls=0;const ipcRenderer={invoke:async(channel,payload)=>{if(channel!=='jc:zhaopin-native-chat')throw Error('Unexpected IPC');if(payload.action==='arm')return{ok:true,nativeChatToken:'native-test'};verifyCalls++;return c.bindingRejectedAfterPrepare&&verifyCalls>1?{ok:false}:{...c.nativeBinding,expiresAt:Date.now()+(c.expiredBinding?-1:90000)};}};
const trustedInput=async(action,value)=>{if(c.inputFail)return{ok:false};document.activeElement.value=value;if(c.afterInput)document.querySelector('.im-main-panel__timeline').insertAdjacentHTML('beforeend',c.afterInput);return{ok:true};};
const clickElement=async el=>{sends++;if(c.open)return;document.querySelector('textarea').value='';if(!c.noBubble){document.querySelector('.im-main-panel__timeline').insertAdjacentHTML('beforeend',${JSON.stringify(message(greeting))});const row=document.querySelector('.im-main-panel__timeline').lastElementChild;if(c.sendStatus==='sending'||c.sendStatus==='fail'){row.querySelector('.im-message__receipt').remove();row.insertAdjacentHTML('beforeend',c.sendStatus==='sending'?'<div class="im-message__send-state">发送中</div>':'<div class="im-message__send-state"><button class="im-message__fail-btn"></button></div>');}if(c.noReceipt)row.querySelector('.im-message__receipt').remove();}};
${names.map(n=>preload.functions.get(n)).join('\n')}
${c.before||''}
const readyBefore=readZhaopinChatReady(document,location.href);
if(c.delayedDetail)document.querySelector('.im-chat-header').insertAdjacentHTML('beforeend',${JSON.stringify(detail(job.url.replace('.htm','.html')))});
const readyAfter=readZhaopinChatReady(document,location.href);
const args={seq:'test',job:c.job||${JSON.stringify(job)},sessionId:c.sessionId||'target',greeting:c.short?'':greeting,defaultGreeting:c.defaultGreeting,nativeChatToken:c.nativeBinding?'native-test':undefined};
let result=await zhaopinChatStep({...args,action:c.open?'open':c.inspect?'inspect':'prepare'}),replayed;
if(result.stage==='prepared'){if(c.changeAfterPrepare)location.href='https://i.zhaopin.com/im?sessionId=other';if(c.detailAfterPrepare)document.querySelector('.im-chat-header__detail').href='https://www.zhaopin.com/jobdetail/ZL111111111J11111111111.html';if(c.historyAfterPrepare)document.querySelector('.im-main-panel__timeline').insertAdjacentHTML('beforeend','<div class="im-main-panel__history-tip is-loading">加载中…</div>');const send={...args,action:'send',token:result.token};result=await zhaopinChatStep(send);if(c.replay)replayed=await zhaopinChatStep(send);}
if(c.open)await new Promise(resolve=>setTimeout(resolve,10));
return {name:c.name,result,sends,replayed,readyBefore,readyAfter,editor:document.querySelector('textarea')?.value};})()`;
cases.forEach(c=>new vm.Script(script(c)));
cases.forEach((c,i)=>writeFileSync(join(work,'fixture-'+i+'.html'),'<meta charset="utf-8"><style>body{font:16px sans-serif}textarea{width:400px;height:70px}button{height:30px}div,span{min-height:20px}</style>'+(c.open||c.noDetails?c.html:linked(c.html))));
const report=join(work,'report.json'),entry=join(work,'main.cjs');
writeFileSync(entry,`const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(work,'profile'))});app.setPath('sessionData',${JSON.stringify(join(work,'profile'))});app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));let code=0;try{const reports=[],scripts=${JSON.stringify(cases.map(script))};for(let i=0;i<scripts.length;i++){await w.loadFile(${JSON.stringify(work)}+'/fixture-'+i+'.html');reports.push(await w.webContents.executeJavaScript(scripts[i]));}fs.writeFileSync(${JSON.stringify(report)},JSON.stringify(reports));}catch(e){fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack}));code=1;}finally{w.destroy();app.exit(code);}});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const run=spawnSync(process.env.BOSSCLAW_ELECTRON||require('electron'),[entry],{env,windowsHide:true,timeout:45000,encoding:'utf8'});
assert.equal(run.status,0,run.error?.message||run.stderr);
const results=JSON.parse(readFileSync(report,'utf8'));assert.ok(!results.error,results.error);
for(let i=0;i<cases.length;i++){const c=cases[i],r=results[i];assert.equal(r.result.stage,c.stage,c.name);assert.equal(r.sends,c.sends,c.name);if(!c.open&&r.result.stage==='failed')assert.equal(r.result.sendAttempted,r.sends>0,c.name+' send boundary');if(c.replay)assert.equal(r.replayed.stage,'failed');
  if(c.name==='分公司同名但岗位编号不同不发送')assert.match(r.result.error,/聊天岗位编号与目标不一致.*目标：ZL000.*当前：ZL111/);
  if(c.noDetails){assert.equal(r.readyBefore,false);if(c.delayedDetail)assert.equal(r.readyAfter,true);else assert.match(r.result.error,/岗位编号尚未确认/);}
  if(['平台默认句后补发工作台文本','分公司全称与聊天母公司简称同岗位'].includes(c.name))assert.equal(r.readyBefore,true);
  if(c.inspect){assert.equal(r.result.nativeChatVerified,true);assert.equal(r.editor,'');}
}
console.log(`PASS Zhaopin greeting: ${cases.length} isolated official-template DOM cases; ${report}`);

// Actual main-process provenance factory, including page-initiated same-frame navigation wiring.
const {createZhaopinNativeChatBindings}=require(join(root,'electron/zhaopin-native-chat.cjs'));
let nativeChecks=0;
function nativeCase(test){let clock=1000,next=0;const bindings=createZhaopinNativeChatBindings({now:()=>clock,nonce:()=>String(++next)}),wc={id:1,url:job.url,getURL(){return this.url;}},other={id:2,url:job.url,getURL(){return this.url;}};bindings.attachGuest(wc);const arm=()=>bindings.arm(wc,job.url),chat='https://i.zhaopin.com/im?sessionId=shared',verify=token=>bindings.verify(wc,{jobUrl:job.url,nativeChatToken:token,expectedSessionId:'shared'}),capture=()=>{assert.equal(bindings.captureWindowOpen(wc,chat),true);wc.url=chat;};test({bindings,wc,other,arm,chat,verify,capture,setClock:n=>clock=n});nativeChecks++;}
nativeCase(({arm})=>assert.equal(arm().ok,true));
nativeCase(({bindings,other})=>assert.equal(bindings.arm(other,job.url).ok,false));
nativeCase(({wc,arm})=>{wc.url=job.url.replace('00000.htm','11111.htm');assert.equal(arm().ok,false);});
nativeCase(({wc,arm})=>{wc.url=job.url.replace('www.zhaopin.com','evil.invalid');assert.equal(arm().ok,false);});
nativeCase(({bindings,wc,arm})=>{arm();assert.equal(bindings.captureWindowOpen(wc,'https://evil.invalid/im?sessionId=shared'),false);});
nativeCase(({arm,capture,verify})=>{const a=arm();capture();assert.equal(verify(a.nativeChatToken).ok,true);});
nativeCase(({bindings,wc,arm,chat,capture})=>{arm();capture();assert.equal(bindings.captureWindowOpen(wc,chat),false);});
nativeCase(({bindings,wc,arm,capture})=>{const a=arm();capture();assert.equal(bindings.verify(wc,{jobUrl:job.url.replace('00000.htm','11111.htm'),nativeChatToken:a.nativeChatToken,expectedSessionId:'shared'}).ok,false);});
nativeCase(({arm,capture,verify})=>{arm();capture();assert.equal(verify('wrong').ok,false);});
nativeCase(({bindings,wc,arm,capture})=>{const a=arm();capture();assert.equal(bindings.verify(wc,{jobUrl:job.url,nativeChatToken:a.nativeChatToken,expectedSessionId:'other'}).ok,false);});
nativeCase(({wc,arm,capture,verify})=>{const a=arm();capture();wc.url='https://i.zhaopin.com/im?sessionId=other';assert.equal(verify(a.nativeChatToken).ok,false);});
nativeCase(({bindings,other,arm,capture,chat})=>{const a=arm();capture();bindings.attachGuest(other);other.url=chat;assert.equal(bindings.verify(other,{jobUrl:job.url,nativeChatToken:a.nativeChatToken,expectedSessionId:'shared'}).ok,false);});
nativeCase(({bindings,wc,arm,chat})=>{arm();wc.url=job.url.replace('00000.htm','11111.htm');assert.equal(bindings.captureWindowOpen(wc,chat),false);});
nativeCase(({bindings,wc,arm,chat,setClock})=>{arm();setClock(47000);assert.equal(bindings.captureWindowOpen(wc,chat),false);});
nativeCase(({arm,capture,verify,setClock})=>{const a=arm();capture();setClock(92000);assert.equal(verify(a.nativeChatToken).ok,false);});
nativeCase(({wc,arm,capture,verify})=>{const a=arm();capture();wc.url=job.url;arm();assert.equal(verify(a.nativeChatToken).ok,false);});
nativeCase(({bindings,wc,arm,capture,verify})=>{const a=arm();capture();bindings.releaseGuest(wc.id);assert.equal(verify(a.nativeChatToken).ok,false);});
nativeCase(({bindings,wc,arm,capture,verify})=>{const a=arm();assert.equal(bindings.captureWindowOpen(wc,'about:blank'),false);capture();assert.equal(verify(a.nativeChatToken).ok,true);});
for (const mode of ['event-url','legacy-url','subframe','released','duplicate-attach']) {
  const bindings=createZhaopinNativeChatBindings(), wc=Object.assign(new EventEmitter(),{id:1,url:job.url,getURL(){return this.url;}});
  bindings.attachGuest(wc);if(mode==='duplicate-attach')bindings.attachGuest(wc);
  assert.equal(wc.listenerCount('will-navigate'),1);
  const armed=bindings.arm(wc,job.url), chat='https://i.zhaopin.com/im?sessionId=shared';
  if(mode==='released'){bindings.releaseGuest(wc.id);assert.equal(wc.listenerCount('will-navigate'),0);}
  wc.emit('will-navigate',mode==='legacy-url'?{}:{url:chat,isMainFrame:mode!=='subframe'},chat);
  wc.url=chat;
  assert.equal(bindings.verify(wc,{jobUrl:job.url,nativeChatToken:armed.nativeChatToken,expectedSessionId:'shared'}).ok,!['subframe','released'].includes(mode));
  nativeChecks++;
}
console.log(`PASS native chat binding: ${nativeChecks} production guest/origin/session/token/expiry checks.`);

// Host navigation and Stop boundaries: run actual production BrowserView function.
let hostChecks=0;
for(const stopAt of ['never','before-open','after-navigation','after-prepare','after-send']){
  let allowed=true,reads=0,sends=0,opens=0,started=0;
  const context={Promise,URL,Date,useCallback:fn=>fn,aliveRef:{current:true},openInNewTab:()=> 'tab',hasTab:()=>true,sleep:async()=>{},
    pageStatus:async()=>{reads++;if(stopAt==='before-open'&&reads===1)allowed=false;if(stopAt==='after-navigation'&&reads===2)allowed=false;return reads===1?{bodyLen:300,readyState:'complete',url:job.url}:{bodyLen:500,readyState:'complete',url:'https://i.zhaopin.com/im?sessionId=target',zhaopinChatReady:true};},
    cmdOnce:async(channel,args)=>{if(args.action==='open'){opens++;return{ok:true,defaultGreeting:platformDefault,nativeChatToken:'native-host-token'};}assert.equal(args.nativeChatToken,'native-host-token');if(args.action==='prepare'){if(stopAt==='after-prepare')allowed=false;return{ok:true,stage:'prepared',token:'t'};}sends++;if(stopAt==='after-send')allowed=false;return{ok:true,stage:'success',greetingConfirmed:true};}};
  vm.createContext(context);vm.runInContext((await transform(`globalThis.greet=${browser.vars.get('zhaopinGreet')};`,{loader:'tsx'})).code,context);
  const result=await context.greet(job,greeting,{canStart:()=>allowed,onStart:()=>started++});
  assert.equal(sends,['never','after-send'].includes(stopAt)?1:0,stopAt);assert.equal(started,sends);assert.equal(result.greetingConfirmed===true,sends===1);hostChecks++;
}
for(const mode of ['transient-detail','transient-chat','persistent-detail','persistent-chat','risk-during-login','stop-during-login']) {
  let tick=0,allowed=true,phase='detail',phaseReads=0,sends=0,opens=0;
  const c={Promise,URL,Date:{now:()=>tick},useCallback:fn=>fn,aliveRef:{current:true},openInNewTab:()=> 'tab',hasTab:()=>true,
    sleep:async()=>{tick+=400;if(mode==='stop-during-login')allowed=false;},
    pageStatus:async()=>{phaseReads++;const here={bodyLen:500,readyState:'complete',url:phase==='detail'?job.url:'https://i.zhaopin.com/im?sessionId=target',zhaopinChatReady:phase==='chat'};
      const affected=mode.endsWith(phase)||mode.endsWith('login')&&phase==='detail';
      if(affected&&(mode.startsWith('persistent')||mode.endsWith('login')||phaseReads<3))return{...here,applyBlock:{kind:mode==='risk-during-login'&&phaseReads>1?'risk':'login',source:'login-panel',message:'需要人工验证'}};
      return here;},
    cmdOnce:async(_channel,args)=>{if(args.action==='open'){opens++;phase='chat';phaseReads=0;return{ok:true,nativeChatToken:'native',defaultGreeting:platformDefault};}if(args.action==='prepare')return{ok:true,stage:'prepared',token:'prepared'};sends++;return{ok:true,stage:'success',greetingConfirmed:true};}};
  vm.createContext(c);vm.runInContext((await transform(`globalThis.greet=${browser.vars.get('zhaopinGreet')};`,{loader:'tsx'})).code,c);
  const result=await c.greet(job,greeting,{canStart:()=>allowed,onStart:()=>{}});
  if(mode.startsWith('transient')){assert.equal(result.greetingConfirmed,true,mode);assert.equal(sends,1,mode);assert.ok(tick>=800,mode);}
  else{assert.equal(result.stage,mode.startsWith('persistent')?'login':mode.startsWith('risk')?'risk':'cancelled',mode);assert.equal(sends,0,mode);if(mode.startsWith('persistent')){assert.ok(tick>=1500&&tick<3000,mode);assert.equal(opens,mode.endsWith('chat')?1:0,mode);}else assert.ok(tick<=400,mode);}
  hostChecks++;
}
console.log(`PASS Zhaopin greeting host: ${hostChecks} production navigation/Stop/login-hydration cases; outbound commands are stubs.`);

// Successful resume delivery survives a message failure, Stop, or exception. Supplement skips submission.
let queueChecks=0;
for(const outcome of ['success','cancelled','failed','risk','throws','supplement','identity-rejected']){
  const item={id:'job',status:'approved_queue',job,deliveryGreeting:greeting,...(outcome==='supplement'?{resumeDeliveredAt:10,sentAt:10}:{})};
  let applies=0,greets=0,pauses=0,closed=0,next=0;const store={autoAssist:true};
  const c={Promise,Date,useDataStore:{getState:()=>({pending:[item]})},useAppStore:{getState:()=>store},deliveryEpochRef:{current:0},deliverySubmittedRef:{current:false},
    updatePending:(id,patch)=>Object.assign(item,patch),claimDelivery:()=>true,releaseDelivery:()=>{},awaitDeliveryGap:async()=>true,canContinueDelivery:()=>true,
    addLog:()=>{},setApplyStage:()=>{},recomputeStats:()=>{},platformLabel:p=>p,requestRunNext:()=>next++,pauseAssist:()=>{pauses++;store.autoAssist=false;},
    handleDelivered:()=>{item.status='sent';closed++;},
    webviewApi:{current:{platformApply:async()=>{applies++;return{ok:true,stage:'success',resumeDelivered:true,tabId:'tab'};},
      zhaopinGreet:async()=>{greets++;if(outcome==='throws')throw Error('draft failure');return outcome==='success'||outcome==='supplement'?{ok:true,stage:'success',greetingConfirmed:true,tabId:'tab'}:{ok:false,stage:outcome==='identity-rejected'?'failed':outcome,...(outcome==='identity-rejected'?{sendAttempted:false}:{}),error:'未确认',tabId:'tab'};},closeTab:()=>closed++}}};
  vm.createContext(c);vm.runInContext((await transform(`globalThis.deliver=${wb.vars.get('deliverNonBoss')};`,{loader:'tsx'})).code,c);
  await c.deliver(item,job.url);
  assert.equal(item.status,'sent',outcome);assert.ok(item.resumeDeliveredAt);assert.equal(greets,1);assert.equal(applies,outcome==='supplement'?0:1);
  if(['failed','risk','throws'].includes(outcome)){assert.equal(item.greetingStatus,'needs_review');assert.equal(closed,0);assert.equal(pauses,1);assert.equal(next,0);}
  if(outcome==='cancelled'){assert.equal(item.greetingStatus,'pending');assert.equal(closed,0);}
  if(outcome==='supplement')assert.equal(item.sentAt,10);
  if(outcome==='identity-rejected'){assert.equal(item.greetingStatus,'pending');assert.equal(item.greetingSendAttempted,false);assert.equal(closed,0);assert.equal(pauses,1);}
  queueChecks++;
}
console.log(`PASS Zhaopin greeting workbench: ${queueChecks} production result/supplement cases; no actual submission or message.`);

const retryFile=join(work,'retry.cjs');writeFileSync(retryFile,(await transform(readFileSync(join(root,'src/lib/bossclaw/zhaopinGreetingRetry.ts'),'utf8'),{loader:'ts',format:'cjs'})).code);
const {canSupplementZhaopinGreeting}=require(retryFile);
const legacy={id:'old',status:'sent',job,deliveryGreeting:greeting,resumeDeliveredAt:10,sentAt:10,greetingStatus:'needs_review',error:'简历已投递；智联聊天中的公司或岗位与目标不一致，工作台招呼语未发送'};
assert.equal(canSupplementZhaopinGreeting(legacy),true);
for(const patch of [{error:'发送结果未确认'},{greetingSendAttempted:true},{greetingStatus:'sent'},{greetingStatus:'skipped'}])assert.equal(canSupplementZhaopinGreeting({...legacy,...patch}),false);
assert.equal(canSupplementZhaopinGreeting({...legacy,error:'等待历史超时',greetingSendAttempted:false}),true);
let starts=0,warnings=0;const retryContext={Date,canSupplementZhaopinGreeting,useDataStore:{getState:()=>({pending:[legacy]})},updatePending:(id,patch)=>Object.assign(legacy,patch),message:{warning:()=>warnings++},addLog:()=>{},startDelivery:()=>starts++};
vm.createContext(retryContext);vm.runInContext((await transform(`globalThis.supplement=${wb.vars.get('onSupplementGreeting')};`,{loader:'tsx'})).code,retryContext);
retryContext.supplement('old');assert.equal(starts,1);assert.equal(warnings,0);assert.equal(legacy.status,'approved_queue');assert.equal(legacy.resumeDeliveredAt,10);assert.equal(legacy.sentAt,10);
console.log('PASS greeting recovery: 7 production policy/action checks; legacy no-send can supplement without resubmitting a resume.');

const bridge=parse('src/lib/bossclaw/camoufox.ts');let bridgeCalls=0;
const ctx={Promise,camoufoxCall:async()=>{bridgeCalls++;return{ok:true,sent:true};}};
vm.createContext(ctx);vm.runInContext((await transform(bridge.functions.get('camoufoxChat').replace(/^export\s+/,'')+';globalThis.chat=camoufoxChat;',{loader:'ts'})).code,ctx);
for(const platform of ['zhaopin','job51']) {const result=await ctx.chat('job',greeting,{platform});assert.equal(result.sent,false);assert.equal(bridgeCalls,0);}
for(const platform of ['boss','liepin'])assert.equal((await ctx.chat('job',greeting,{platform})).sent,true);
assert.equal(bridgeCalls,2);console.log('PASS chat bridge: 4 production dispatch checks; resume-only chat makes no engine calls.');
const py=join(work,'server_test.py');
writeFileSync(py,`import ast,types\nfrom pathlib import Path\nfrom urllib.parse import urlparse,parse_qs\nroot=Path(${JSON.stringify(root)})\ntree=ast.parse((root/'camoufox/camoufox_server.py').read_text(encoding='utf-8-sig'))\ncls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='CamoufoxHandler')\nfn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='do_POST')\ncalls=[]\ndef boundary(*args,**kw):\n calls.append(args);return {'ok':True,'sent':True}\nns={'urlparse':urlparse,'parse_qs':parse_qs,'PLATFORMS':('boss','liepin','zhaopin','job51'),'platform_mods':types.SimpleNamespace(deliver=boundary),'chat_greeting':boundary,'log':lambda *a:None}\nexec(compile(ast.Module(body=[fn],type_ignores=[]),'production_handler','exec'),ns)\nfor platform in ('zhaopin','job51','boss','liepin'):\n h=types.SimpleNamespace(path='/chat?token=fixture',server=types.SimpleNamespace(token='fixture'),_read_body=lambda p=platform:{'platform':p,'jobId':'job','greeting':'fixture greeting'},_send=lambda status,result:result)\n result=ns['do_POST'](h)\n assert result['sent']==(platform in ('boss','liepin'))\n assert len(calls)==(('boss','liepin').index(platform)+1 if platform in ('boss','liepin') else 0)\nprint('PASS Python /chat: 4 production handler checks; browser/send boundaries are stubs.')\n`);
const python=spawnSync(process.env.BOSSCLAW_PYTHON||'python',[py],{windowsHide:true,timeout:10000,encoding:'utf8'});
assert.equal(python.status,0,python.error?.message||python.stderr);console.log(python.stdout.trim());
await import('./zhaopin-attachment-regression.mjs');
