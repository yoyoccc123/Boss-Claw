// Native request boundary + isolated UI workflows. No recruitment requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url),root=dirname(dirname(fileURLToPath(import.meta.url)));
const {inspectZhaopinAttachment,createZhaopinAttachmentPolicy}=require(join(root,'electron/zhaopin-attachment-policy.cjs'));
const work=mkdtempSync(join(tmpdir(),'bossclaw-zhaopin-attachment-'));
const endpoint='https://capi.zhaopin.com/c/pc/alan/jobs/application';
const request=body=>({url:endpoint,method:'POST',webContentsId:42,uploadData:[{bytes:Buffer.from(JSON.stringify(body))}]});
const attachment={attachmentDefaultType:'attachment',attachmentDefaultFileId:'fixture-file',at:'fixture-secret'};
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
check(inspectZhaopinAttachment(request(attachment)).allowed,'explicit attachment may be submitted');
for(const body of [{},{...attachment,attachmentDefaultType:'online'},{...attachment,attachmentDefaultType:''},
 {...attachment,attachmentDefaultFileId:''},{...attachment,attachmentDefaultFileId:null},
 {...attachment,attachmentDefaultFileId:0},{...attachment,attachmentDefaultFileId:'undefined'},
 {...attachment,attachmentDefaultFileId:{}},{...attachment,attachmentDefaultFileId:true}]) {
 check(!inspectZhaopinAttachment(request(body)).allowed,'online/missing/invalid attachment cannot leave');
}
for(const parts of [undefined,[],[{file:'private.pdf'}],[{blobUUID:'fixture'}],[{bytes:Buffer.from('not json')}],[{bytes:Buffer.from('{}')},{file:'private'}]]) {
 check(!inspectZhaopinAttachment({...request(attachment),uploadData:parts}).allowed,'unreadable/partial request body fails closed');
}
const joined=Buffer.from(JSON.stringify(attachment));
check(inspectZhaopinAttachment({...request(attachment),uploadData:[{bytes:joined.subarray(0,9)},{bytes:joined.subarray(9)}]}).allowed,'split byte chunks are parsed together');
for(const change of [{url:endpoint+'/preparation'},{url:'https://www.zhipin.com/c/pc/alan/jobs/application'},
 {url:'https://zhaopin.com.evil.invalid/c/pc/alan/jobs/application'},{method:'GET'}]) {
 check(!inspectZhaopinAttachment({...request({}),...change}).applies,'unrelated/read-only requests retain their behavior');
}
let installs=0,listener;
const browserSession={webRequest:{onBeforeRequest:(_filter,fn)=>{installs++;listener=fn;}}},wc={id:42,session:browserSession};
const policy=createZhaopinAttachmentPolicy();
check(!policy.begin(wc).ok,'no application may start before its guard is installed');
policy.install(browserSession);policy.install(browserSession);check(installs===1,'one centralized listener per session');
policy.begin(wc);let result;
listener(request({...attachment,attachmentDefaultType:'online'}),r=>result=r);
check(result.cancel && policy.read(wc).blocked,'native callback cancels online and exposes a safe reason');
policy.begin(wc);listener(request(attachment),r=>result=r);
check(!result.cancel && policy.read(wc).allowedRequests===1,'new attempt with attachment is allowed');
check(!JSON.stringify(policy.read(wc)).includes('fixture-secret') && !JSON.stringify(policy.read(wc)).includes('fixture-file'),'state retains no credentials or attachment identifiers');
policy.release(wc.id);check(!policy.read(wc).ok,'destroyed guest state is released');
console.log(`PASS Zhaopin attachment policy: ${checks} payload/session/privacy checks.`);

// Actual Electron onBeforeRequest uploadData, with https fully handled offline.
// A canceled request must not reach even the synthetic transport.
const run=async function(){
 const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs');
 const {createZhaopinAttachmentPolicy}=require(ROOT+'/electron/zhaopin-attachment-policy.cjs');
 app.setPath('userData',WORK+'/profile');await app.whenReady();
 const ses=session.fromPartition('zhaopin-attachment-offline'),wire=[],checks=[];
 const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
 await ses.protocol.handle('https',async req=>{
  const url=new URL(req.url);
  if(url.pathname==='/c/pc/alan/jobs/application') {const body=await req.json();wire.push({type:body.attachmentDefaultType});return new Response('{"success":true}',{headers:{'content-type':'application/json'}});}
  return new Response('<meta charset="utf-8"><iframe srcdoc="<p>offline child</p>"></iframe>',{headers:{'content-type':'text/html'}});
 });
 const guard=createZhaopinAttachmentPolicy();guard.install(ses);let headers=0;
 ses.webRequest.onBeforeSendHeaders((d,cb)=>{headers++;cb({requestHeaders:d.requestHeaders});});
 const local=require('node:http').createServer((_req,res)=>res.end('offline'));
 await new Promise(resolve=>local.listen(0,'127.0.0.1',resolve));
 const win=new BrowserWindow({show:false,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true}}),wc=win.webContents;
 const evaluate=s=>wc.executeJavaScript(s);
 try{
  await wc.loadURL('https://www.zhaopin.com/offline-fixture');
  const send=async(body,child=false)=>{
   guard.begin(wc);
   const value=await evaluate(`(async()=>{try{const response=await ${child?'document.querySelector("iframe").contentWindow.':''}fetch('/c/pc/alan/jobs/application',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}});return response.ok;}catch{return false;}})()`);
   return {value,state:guard.read(wc)};
  };
  let r=await send({attachmentDefaultType:'online',attachmentDefaultFileId:''});
  check(!r.value&&r.state.blocked&&wire.length===0,'online request canceled before offline transport');
  r=await send({attachmentDefaultType:'attachment',attachmentDefaultFileId:'fixture-file'});
  check(r.value&&r.state.allowedRequests===1&&wire.length===1,'real uploadData with explicit attachment passes');
  r=await send({attachmentDefaultType:'online',attachmentDefaultFileId:''},true);
  check(!r.value&&r.state.blocked&&wire.length===1,'iframe application is guarded in the same guest');
  r=await send({resumeNumber:'fixture-resume'});
  check(!r.value&&r.state.blocked&&wire.length===1,'implicit online fallback is canceled');
  await ses.fetch('http://127.0.0.1:'+local.address().port+'/headers');
  check(headers>0,'existing request-header listener still executes on the loopback transport');
  check(wire.every(r=>r.type==='attachment'),'zero online submissions reach any transport');
  fs.writeFileSync(REPORT,JSON.stringify({checks,externalNetwork:false}));
 }catch(e){fs.writeFileSync(REPORT,JSON.stringify({error:e.stack,checks}));process.exitCode=1;}
 finally{await new Promise(resolve=>local.close(resolve));win.destroy();app.quit();}
};
const report=join(work,'native-report.json'),entry=join(work,'main.cjs');
writeFileSync(entry,`const ROOT=${JSON.stringify(root)},WORK=${JSON.stringify(work)},REPORT=${JSON.stringify(report)};(${run})().catch(e=>{require('node:fs').writeFileSync(REPORT,JSON.stringify({error:e.stack}));require('electron').app.exit(1);});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const native=spawnSync(process.env.BOSSCLAW_ELECTRON||require('electron'),[entry],{env,windowsHide:true,timeout:30000,encoding:'utf8'});
assert.equal(native.status,0,native.error?.message||native.stderr);
const nativeReport=JSON.parse(readFileSync(report,'utf8'));assert.ok(!nativeReport.error,nativeReport.error);
console.log(`PASS actual Zhaopin attachment request boundary: ${nativeReport.checks.length} native upload/iframe/transport checks; zero platform traffic.`);

// Compile the actual legacy entry without importing any browser engine.
const py=join(work,'attachment_legacy.py');
writeFileSync(py,`import ast,types
from pathlib import Path
root=Path(${JSON.stringify(root)})
tree=ast.parse((root/'camoufox/platforms/zhaopin.py').read_text(encoding='utf-8-sig'))
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='deliver')
calls=[]
ns={'_COLLECTOR':types.SimpleNamespace(deliver=lambda *a:calls.append(a))}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'actual_legacy_entry','exec'),ns)
for flag in (False,True):
 result=ns['deliver']({'jobId':'fixture'},'fixture greeting',send_online_resume=flag)
 assert result['ok'] is False and result['sent'] is False
assert calls==[]
print('PASS Python legacy dispatch: attachment-only policy cannot fall back to generic online delivery; no browser/network.')
`);
const python=spawnSync(process.env.BOSSCLAW_PYTHON||'python',[py],{windowsHide:true,timeout:10000,encoding:'utf8'});
assert.equal(python.status,0,python.error?.message||python.stderr);console.log(python.stdout.trim());
await import('./zhaopin-block-regression.mjs');
