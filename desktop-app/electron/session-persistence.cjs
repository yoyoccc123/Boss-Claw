'use strict';
const fs = require('node:fs');
const path = require('node:path');

const WUBA_AUTH = new Set(['ppu', 'ppu.sig', 'cloudpassport', 'passportaccount']);
function authMetadata(cookie) {
  const name = String(cookie?.name || '').toLowerCase();
  const domain = String(cookie?.domain || '').toLowerCase().replace(/^\.+/, '');
  if (!WUBA_AUTH.has(name) || (domain !== '58.com' && !domain.endsWith('.58.com'))) return null;
  return { name, domain, session: Boolean(cookie.session),
    expires: Number.isFinite(cookie.expirationDate) ? cookie.expirationDate : null,
    present: Boolean(cookie.value) };
}

// Only an allowlisted metadata projection reaches this bounded log. Never save cookie values,
// request headers, account names, full URLs, or an authentication backup to restore later.
function createMetadataLog(file) {
  return entry => {
    try {
      const max = 128 * 1024;
      if (fs.existsSync(file) && fs.statSync(file).size > max) {
        const tail = fs.readFileSync(file).subarray(-max / 2).toString('utf8');
        fs.writeFileSync(file, tail.slice(tail.indexOf('\n') + 1));
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    } catch { /* A diagnostic write must never prevent normal browser use or quitting. */ }
  };
}

function installSessionPersistence({ app, browserSession, otherSessions = [], record = () => {},
  flushDelayMs = 500, quitTimeoutMs = 4000 }) {
  const sessions = [...new Set([browserSession, ...otherSessions])];
  let saveTimer = null, saving = null, dirty = false, quitting = false, allowQuit = false;
  const note = entry => { try { record(entry); } catch {} };
  const snapshot = async phase => {
    try {
      const all = await browserSession.cookies.get({});
      note({ event: 'auth-state', phase, cookies: all.map(authMetadata).filter(Boolean) });
    } catch { note({ event: 'auth-state', phase, result: 'read-failed' }); }
  };
  // Serialize writes and drain changes received while an earlier write is in flight.
  function flush() {
    dirty = true;
    if (saving) return saving;
    saving = (async () => {
      do {
        dirty = false;
        const results = await Promise.allSettled(sessions.map(async ses => {
          ses.flushStorageData();
          await ses.cookies.flushStore();
        }));
        note({ event: 'storage-flush', result: results.every(r => r.status === 'fulfilled') ? 'saved' : 'failed' });
      } while (dirty);
    })().finally(() => { saving = null; });
    return saving;
  }
  function changed(_event, cookie, cause, removed) {
    const metadata = authMetadata(cookie);
    if (!metadata) return;
    const knownCauses = ['inserted', 'inserted-no-change-overwrite', 'inserted-no-value-change-overwrite',
      'explicit', 'overwrite', 'expired', 'evicted', 'expired-overwrite'];
    note({ event: 'auth-change', cookie: metadata, cause: knownCauses.includes(cause) ? cause : 'other', removed: Boolean(removed) });
    if (quitting) { if (saving) dirty = true; return; }
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, flushDelayMs);
  }
  browserSession.cookies.on('changed', changed);
  const ready = snapshot('startup');
  function beforeQuit(event) {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearTimeout(saveTimer); saveTimer = null;
    let deadline;
    const timeout = new Promise(resolve => { deadline = setTimeout(() => resolve('timeout'), quitTimeoutMs); });
    const saved = flush().then(() => snapshot('shutdown')).then(() => 'finished');
    void Promise.race([saved, timeout]).then(result => {
      clearTimeout(deadline);
      note({ event: 'shutdown-save', result });
      allowQuit = true;
      app.quit();
    });
  }
  app.on('before-quit', beforeQuit);
  app.once('will-quit', () => {
    clearTimeout(saveTimer);
    browserSession.cookies.removeListener('changed', changed);
  });
  return { ready, flush };
}

module.exports = { authMetadata, createMetadataLog, installSessionPersistence };
