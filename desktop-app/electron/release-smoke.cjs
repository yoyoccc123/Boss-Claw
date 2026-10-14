'use strict';
// Explicit release fixture mode; no effect in ordinary user sessions.
const fs = require('node:fs'), path = require('node:path');
function configureReleaseSmoke(app, session, nativeImage) {
  const value = process.env.BOSSCLAW_RELEASE_SMOKE_DIR;
  if (!value) return { attach() {} };
  const root = path.resolve(value), marker = JSON.parse(fs.readFileSync(path.join(root, '.bossclaw-owned.json'), 'utf8'));
  if (marker.owner !== 'BossClaw-release-v1' || marker.kind !== 'smoke' || fs.lstatSync(root).isSymbolicLink()) throw Error('Invalid isolated release fixture');
  const profile = path.join(root, 'profile'), home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile); app.setPath('sessionData', profile); app.setPath('home', home);
  const resultPath = path.join(root, 'smoke-result.json');
  const finish = (result, code = 0) => { fs.writeFileSync(resultPath, JSON.stringify(result, null, 2)); app.exit(code); };
  const events = []; let lastState, fixtureGuestAdded = false;
  const note = (name, value) => { if (events.length < 30) events.push({ name, value }); };
  const deadline = setTimeout(() => finish({ success: false, error: 'Packaged UI startup timed out', events, lastState, platformRequestsAllowed: false }, 1), 45000);
  let guestPreloadLoaded = false;
  app.on('web-contents-created', (_, wc) => {
    if (wc.getType() === 'webview') wc.on('console-message', (_event, ...args) => {
      const message = typeof _event?.message === 'string' ? _event.message
        : args.find(v => v && typeof v.message === 'string')?.message || args.find(v => typeof v === 'string');
      if (message?.includes('BOSS-CLAW-PRELOAD-INJECTED')) guestPreloadLoaded = true;
    });
  });
  app.whenReady().then(() => {
    if (app.getPath('userData') !== profile) return finish({ success: false, error: 'Fixture isolation was lost' }, 1);
    for (const ses of [session.defaultSession, session.fromPartition('persist:bossclaw')])
      ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, cb) => cb({ cancel: true }));
  });
  return { attach(win) {
    win.webContents.on('dom-ready', () => note('dom-ready', win.webContents.getURL()));
    win.webContents.on('did-fail-load', (_e, code, description, url) => note('did-fail-load', { code, description, url }));
    win.webContents.on('preload-error', (_e, file, error) => note('preload-error', { file, message: error.message }));
    win.webContents.on('console-message', (event) => { if (event.level === 'error' || event.level === 3) note('console-error', event.message); });
    win.webContents.once('did-finish-load', async () => {
      note('did-finish-load', win.webContents.getURL());
      try {
        let state;
        for (let i = 0; i < 50; i++) {
          state = await win.webContents.executeJavaScript("(async()=>{const d=JSON.parse(localStorage.getItem('bossclaw-data')||'null')?.state;const a=JSON.parse(localStorage.getItem('bossclaw-app')||'null')?.state;return {rendered:document.getElementById('root')?.children.length>0,appPreload:typeof window.electron?.getAppInfo==='function',resumeVariants:d?.resumeVariants?.length,pending:d?.pending?.length,autoAssist:a?.autoAssist}})()");
          lastState = state;
          if (state.rendered && state.appPreload && !fixtureGuestAdded) {
            // Exercise the real guest preload on a local document: platform requests stay blocked.
            const url = require('node:url').pathToFileURL(path.join(root, 'old-unpacked-origin.html')).href;
            await win.webContents.executeJavaScript("(()=>{const w=document.createElement('webview');w.setAttribute('partition','persist:bossclaw');w.setAttribute('webpreferences','contextIsolation=yes,sandbox=no,backgroundThrottling=no');w.style.cssText='width:100px;height:100px;position:fixed;left:0;top:0';w.src=" + JSON.stringify(url) + ";document.body.appendChild(w);})()");
            fixtureGuestAdded = true;
          }
          if (state.rendered && state.appPreload && guestPreloadLoaded) break;
          await new Promise(r => setTimeout(r, 250));
        }
        const { runtimePaths } = require('./runtime-paths.cjs'), paths = runtimePaths(app);
        const originals = require('original-fs');
        for (const key of ['bridge', 'camoufox', 'appPreload', 'webviewPreload', 'icon'])
          if (!originals.existsSync(paths[key])) throw Error('External resource missing: ' + key);
        if (nativeImage.createFromPath(paths.icon).isEmpty()) throw Error('Packaged application icon is empty');
        const cloak = await import('cloakbrowser');
        if (typeof cloak.launchPersistentContext !== 'function') throw Error('CloakBrowser production dependency was not preserved');
        if (!app.getAppPath().endsWith('app.asar') || !state.rendered || !state.appPreload || !guestPreloadLoaded ||
            state.resumeVariants !== 2 || state.pending !== 1 || state.autoAssist !== false) throw Error('ASAR UI, preloads or prior file-origin storage failed verification');
        clearTimeout(deadline);
        finish({ success: true, version: app.getVersion(), electronVersion: process.versions.electron, asar: true, guestPreloadLoaded, ...state,
          externalResourcesVerified: true, cloakModuleLoaded: true, platformRequestsAllowed: false, userProfileUsed: false });
      } catch (e) { clearTimeout(deadline); finish({ success: false, error: e.message, events, lastState, platformRequestsAllowed: false }, 1); }
    });
  } };
}
module.exports = { configureReleaseSmoke };
