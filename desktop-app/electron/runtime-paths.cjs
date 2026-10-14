'use strict';
const path = require('node:path');

function resolveRuntimePaths({ packaged, appPath, resourcesPath, userData, platform = process.platform }) {
  const external = packaged ? resourcesPath : appPath;
  const preloads = packaged ? path.join(resourcesPath, 'app.asar.unpacked', 'electron', 'preload') : path.join(appPath, 'electron', 'preload');
  const venv = packaged ? path.join(userData, 'python-runtime', '.venv') : path.join(appPath, '.venv');
  return {
    bridge: path.join(external, 'bridge', 'server.cjs'),
    camoufox: path.join(external, 'camoufox', 'camoufox_server.py'),
    appPreload: path.join(preloads, 'app.cjs'), webviewPreload: path.join(preloads, 'webview.cjs'),
    icon: packaged ? path.join(resourcesPath, 'assets', 'icon.ico') : path.join(appPath, 'resources', 'icon.ico'),
    venv, python: path.join(venv, ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'])),
  };
}
function runtimePaths(app) {
  return resolveRuntimePaths({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, userData: app.getPath('userData') });
}
module.exports = { resolveRuntimePaths, runtimePaths };
