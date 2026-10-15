// Actual Electron DOM/hit-testing and trusted native input. Every URL is served offline.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = process.env.BOSSCLAW_BUILD_ROOT ? (process.env.TEMP || join(process.env.BOSSCLAW_BUILD_ROOT,'test-tmp/send-ui')) : 'E:/BossClaw-build/test-tmp/send-ui';
mkdirSync(tempRoot,{recursive:true});
const fixture = mkdtempSync(join(tempRoot, 'boss-send-ui-')), reportPath = join(fixture, 'report.json');
const source = ts.createSourceFile('main.cjs', readFileSync(join(root,'electron/main.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let handler;
const visit = n => { if(ts.isCallExpression(n) && n.expression.getText(source)==='ipcMain.on' && n.arguments[0]?.text==='jc:webview-input') handler=n.arguments[1].getText(source); ts.forEachChild(n,visit); }; visit(source);
assert.ok(handler);
const markup = `<meta charset="utf-8"><style>body{margin:0}.chat-conversation{width:700px;height:400px}.message-controls{position:relative;height:200px}#chat-input{position:absolute;top:40px;left:10px;width:600px;height:100px}.btn-sendimg{position:absolute;left:20px;top:160px;width:30px;height:30px}.btn-send{position:absolute;left:600px;top:160px;width:70px;height:35px}#overlay{position:absolute;left:600px;top:160px;width:70px;height:35px;z-index:10;display:none}</style>
<div class="user-list-content"><div class="friend-content-warp"><div class="friend-content selected">联系人</div></div></div>
<div class="chat-conversation"><div class="chat-record"></div><div class="message-controls"><div class="chat-im chat-editor"><div class="editor-container"><div id="chat-input" class="chat-input" contenteditable="true"></div></div></div>
<div class="toolbar-btn-content icon btn-sendimg tooltip" aria-label="发送图片"><input id="file" type="file" accept="image/*"></div><button class="btn-v2 btn-sure-v2 btn-send">发送<span></span></button><label id="overlay" for="file">发送图片</label><div id="phone" class="side-bar-item" style="position:absolute;left:600px;top:160px;width:50px;height:35px;z-index:10;display:none"><i class="iboss-dianhuaicon"></i></div></div></div>`;
const initialize = function() {
 window.events={text:0,image:0,file:0,phone:0};
 const native={encryptJobId:'job-A',encryptBossId:'hr-A',uid:'hr-native-A',uniqueId:'hr-native-A_0'};
 document.querySelector('.user-list-content').__vue__={$props:{dataSources:[native]}};
 document.querySelector('.friend-content-warp').__vue__={$props:{source:native,selected:native.uniqueId}};
 document.querySelector('.chat-record').__vue__={$data:{boss:native,loading:false},$store:{state:{userInfo:{userId:'self'}}}};
 window.reset=()=>{window.events={text:0,image:0,file:0,phone:0};document.querySelector('.chat-record').innerHTML='';document.querySelector('#overlay').style.display='none';document.querySelector('#phone').style.display='none';document.querySelector('.btn-send').classList.remove('disabled');document.querySelector('.btn-send').setAttribute('data-bossclaw-text-send','fixture-send');document.querySelector('#chat-input').innerText='有 Python 自动化开发实践，希望进一步沟通这个岗位。';document.querySelector('#chat-input').focus();};
 window.reply=()=>{const e=document.createElement('div');e.className='message-item item-friend';e.__vue__={$props:{message:{type:1,fromId:native.uid,mid:42,received:true,text:'方便介绍一下项目吗？'}}};document.querySelector('.chat-record').append(e);};
 document.querySelector('.btn-send').addEventListener('click',e=>{if(e.isTrusted)window.events.text++;});
 document.querySelector('.btn-sendimg').addEventListener('click',e=>{window.events.image++;e.preventDefault();});
 document.querySelector('#file').addEventListener('click',e=>{window.events.file++;e.preventDefault();});
 document.querySelector('#phone').addEventListener('click',()=>window.events.phone++);
 window.reset();
};
const run = async function() {
 const { app, BrowserWindow, session }=require('electron'), fs=require('node:fs'), vm=require('node:vm');
 const { dispatchBossChatInput }=require(ROOT+'/electron/preload/boss-chat-context.cjs');
 const { findTextSendButton,isTextSendControl }=require(ROOT+'/electron/preload/text-send-control.cjs');
 app.setPath('userData',FIXTURE+'/profile');
 const deadline=setTimeout(()=>{fs.writeFileSync(REPORT,JSON.stringify({error:'Offline send UI timed out'}));app.exit(1);},45000);
 await app.whenReady();
 const ses=session.fromPartition('boss-send-offline');let external=0;
 await ses.protocol.handle('https',request=>{if(request.url!=='https://www.zhipin.com/web/geek/chat')external++;return new Response(MARKUP,{headers:{'content-type':'text/html; charset=utf-8'}});});
 ses.webRequest.onBeforeRequest({urls:['http://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
 const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}}), wc=win.webContents;
 const checks=[], check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
 const evaluate=s=>wc.executeJavaScript(s);
 const listener=vm.runInNewContext('('+HANDLER+')',{dispatchBossChatInput,Date,Math,Number,String,Array,setTimeout,inputWindowFor:()=>[],inputWindows:new Map(),dlog:()=>{}});
 const job={jobId:'job-A',encryptUserId:'hr-A',url:'https://www.zhipin.com/job_detail/job-A.html'}, greeting='有 Python 自动化开发实践，希望进一步沟通这个岗位。';
 const invoke=async(mode,action='clickAt')=>{
  let injected=false;
  const result=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Native input reply timed out: '+mode)),5000);
   const sender={id:wc.id,isDestroyed:()=>false,once:()=>{},executeJavaScript:s=>evaluate(s),insertText:t=>wc.insertText(t),
    send:(_,r)=>{clearTimeout(timer);resolve(r);},sendInputEvent:e=>{
     if(mode==='reply-during-move' && !injected && e.type==='mouseMove'){injected=true;evaluate('window.reply()');}
     wc.sendInputEvent(e);
    }};
   // The old point is the image button; dispatch must use the live text button instead.
   listener({sender},{seq:mode,action,text:greeting,bossTarget:job,bossInput:{marker:'fixture-send',greeting},x:35,y:210,
    path:[{x:20,y:200,delayMs:20},{x:35,y:210,delayMs:20}]});
  });
  await evaluate('new Promise(r=>setTimeout(r,70))');
  return {result,events:await evaluate('window.events')};
 };
 try {
  await wc.loadURL('https://www.zhipin.com/web/geek/chat');wc.focus();await evaluate('('+INITIALIZE+')()');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const pick=`(()=>{const isTextSendControl=${isTextSendControl.toString()};const findTextSendButton=${findTextSendButton.toString()};return findTextSendButton(document,document.querySelector('#chat-input'))?.className;})()`;
  check(await evaluate(pick)==='btn-v2 btn-sure-v2 btn-send','actual DOM excludes the captured btn-sendimg image toolbar');
  let r=await invoke('live-point');check(r.result.ok && r.events.text===1 && r.events.image===0 && r.events.file===0,'real trusted click uses live text-send coordinates, never the supplied image coordinates: '+JSON.stringify(r));
  await evaluate('window.reset();document.querySelector("#phone").style.display="block"');
  r=await invoke('phone-overlay');check(r.result.ok && r.result.x>650 && r.events.text===1 && r.events.phone===0 && r.events.file===0 && r.events.image===0,'captured phone/App sidebar over button center selects exposed text-send area without clicking the sidebar');
  await evaluate('window.reset();document.querySelector("#overlay").style.display="block"');
  r=await invoke('overlay');check(!r.result.ok && /未找到可安全点击的位置/.test(r.result.error) && r.events.text===0 && r.events.image===0 && r.events.file===0,'a full file-picker overlay cancels physical click and reports its actual cause');
  await evaluate('window.reset();document.querySelector(".btn-send").classList.add("disabled")');
  r=await invoke('disabled');check(!r.result.ok && r.events.text===0 && r.events.file===0,'disabled text-send button cancels dispatch');
  await evaluate('window.reset();window.reply()');r=await invoke('hr-replied');
  check(r.result.skipped===true && r.events.text===0 && r.events.file===0,'native HR reply is skipped before dispatch');
  await evaluate('window.reset()');r=await invoke('reply-during-move');
  check(r.result.skipped===true && r.events.text===0 && r.events.file===0,'HR reply arriving during real mouse movement cancels sending');
  await evaluate('window.reset();document.querySelector("#chat-input").innerText="另一个岗位的草稿"');r=await invoke('changed-draft');
  check(!r.result.ok && r.events.text===0 && r.events.file===0,'changed draft cannot send to the selected contact');
  await evaluate('window.reset();document.querySelector("#chat-input").blur()');r=await invoke('wrong-focus','pressEnter');
  check(!r.result.ok && r.events.text===0 && r.events.file===0,'Enter fallback is rejected when focus leaves the editor');
  check(external===0,'zero external platform requests');
  fs.writeFileSync(REPORT,JSON.stringify({checks,platformRequests:0}));
 }catch(e){fs.writeFileSync(REPORT,JSON.stringify({error:e.stack,checks}));process.exitCode=1;}
 finally{clearTimeout(deadline);win.destroy();app.quit();}
};
writeFileSync(join(fixture,'main.cjs'),`const ROOT=${JSON.stringify(root)},FIXTURE=${JSON.stringify(fixture)},REPORT=${JSON.stringify(reportPath)},HANDLER=${JSON.stringify(handler)},MARKUP=${JSON.stringify(markup)},INITIALIZE=${JSON.stringify(initialize.toString())};(${run.toString()})().catch(e=>{require('node:fs').writeFileSync(REPORT,JSON.stringify({error:e.stack}));require('electron').app.exit(1);});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve,reject)=>{
 const child=spawn(process.env.BOSSCLAW_ELECTRON||require('electron'),[join(fixture,'main.cjs')],{env,windowsHide:true,stdio:'ignore'});
 const timer=setTimeout(()=>{child.kill();reject(Error('Offline Electron test timed out'));},55000);
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',()=>{clearTimeout(timer);resolve();});
});
const report=JSON.parse(readFileSync(reportPath,'utf8'));assert.ok(!report.error,report.error+'\nCompleted: '+JSON.stringify(report.checks));
console.log('PASS actual BOSS send UI: '+report.checks.length+' DOM/hit-test/trusted-input checks; zero platform requests.');
