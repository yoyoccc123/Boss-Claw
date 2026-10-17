'use strict';

// Acquire before creating any Session, opening a database or resetting/migrating profile data.
// Concurrent Chromium processes sharing one profile can report an empty cookie jar.
function claimSingleInstance(app, getWindow) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return; // Initial startup will show its own window when ready.
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  return true;
}

module.exports = { claimSingleInstance };
