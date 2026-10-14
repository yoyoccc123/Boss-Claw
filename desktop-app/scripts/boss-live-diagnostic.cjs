'use strict';
// Run with Electron against an already copied profile. No app, scheduler, apply or send commands.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(root, 'userData-backup')) || !fs.existsSync(path.join(root, 'diagnostic-profile')))
  throw Error('An explicit backed-up diagnostic profile is required');
const project = path.resolve(__dirname, '..'), preload = path.join(root, 'preload');
fs.mkdirSync(preload, { recursive: true });
for (const name of fs.readdirSync(path.join(project, 'electron/preload')))
  if (name.endsWith('.cjs')) fs.copyFileSync(path.join(project, 'electron/preload', name), path.join(preload, name));
const source = fs.readFileSync(path.join(preload, 'webview.cjs'), 'utf8'), end = source.lastIndexOf('})();');
if (end < 0) throw Error('Production preload wrapper missing');
const hook = `
const productionNotify = notify;
notify = function(channel,payload) { productionNotify(channel,payload); if(channel==='apply-stage') ipcRenderer.send('bossclaw-diagnostic-stage',payload); };
ipcRenderer.on('bossclaw-diagnostic-contact',async(_e,{job,seq})=>{
  try {const before=await bossChatContext(job,{mark:true,marker:'diagnostic-target'});const result=await selectBossChatContact(job);ipcRenderer.send('bossclaw-diagnostic-result',{seq,before,result,messageCommands:0,applicationCommands:0});}
  catch(e){ipcRenderer.send('bossclaw-diagnostic-result',{seq,error:e.message,context:await bossChatContext(job).catch(e=>({error:e.message})),messageCommands:0,applicationCommands:0});}
});
`;
fs.writeFileSync(path.join(preload, 'webview.cjs'), source.slice(0, end) + hook + source.slice(end));
app.setName('BossClaw');
app.setPath('userData', path.join(root, 'diagnostic-profile'));
app.setPath('sessionData', path.join(root, 'diagnostic-profile'));
fs.mkdirSync(path.join(root, 'isolated-home'), { recursive: true }); app.setPath('home', path.join(root, 'isolated-home'));
app.commandLine.appendSwitch('remote-debugging-port', '19335');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
const stages = [];
ipcMain.on('bossclaw-diagnostic-stage', (_e, payload) => {
  stages.push({ at: Date.now(), ...payload });
  fs.writeFileSync(path.join(root, 'preload-stages.json'), JSON.stringify(stages, null, 2));
});
ipcMain.on('bossclaw-diagnostic-result', (_e, payload) => {
  if (!/^[a-z0-9-]+$/i.test(String(payload.seq))) return;
  fs.writeFileSync(path.join(root, 'selection-' + payload.seq + '.json'), JSON.stringify(payload, null, 2));
});
app.whenReady().then(async () => {
  const guest = session.fromPartition('persist:bossclaw'), stealth = require(path.join(preload, 'stealth.cjs'));
  const profile = stealth.resolveProfile(); guest.setUserAgent(stealth.buildUserAgent(profile));
  const overrides = stealth.buildRequestHeaderOverrides(profile);
  guest.webRequest.onBeforeSendHeaders((details, cb) => cb({ requestHeaders: { ...details.requestHeaders, ...overrides } }));
  guest.webRequest.onBeforeRequest({ urls: ['*://*.zhipin.com/*'] }, (details, cb) => {
    const name = new URL(details.url).pathname;
    cb({ cancel: /friend\/(?:add|del)\.|chat\/send\.|resume\/send\.|application\/add\./i.test(name) });
  });
  guest.registerPreloadScript({ type: 'frame', id: 'bossclaw-webview-preload', filePath: path.join(preload, 'webview.cjs') });
  const win = new BrowserWindow({ show: false, width: 1450, height: 1000, title: 'BOSS 当前会话路径核对',
    webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true, sandbox: false, backgroundThrottling: false } });
  win.webContents.on('did-attach-webview', (_, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    fs.writeFileSync(path.join(root, 'guest-ready.json'), JSON.stringify({ id: wc.id }));
  });
  const html = path.join(root, 'host.html');
  fs.writeFileSync(html, '<html><body style="margin:0"><webview style="width:100vw;height:100vh" partition="persist:bossclaw" webpreferences="contextIsolation=yes,sandbox=no,backgroundThrottling=no" preload="' +
    pathToFileURL(path.join(preload, 'webview.cjs')).href + '" src="https://www.zhipin.com/web/geek/chat"></webview></body></html>');
  await win.loadFile(html);
  const data = await win.webContents.executeJavaScript("JSON.parse(localStorage.getItem('bossclaw-data')||'null')?.state");
  if (data) fs.writeFileSync(path.join(root, 'current-data.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(root, 'diagnostic-ready.json'), JSON.stringify({ pid: process.pid, productionPreloadUsed: true, isolatedProfile: true, sendAndApplyBlocked: true }));
});
app.on('window-all-closed', () => app.quit());
