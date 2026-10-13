'use strict';
const { randomUUID } = require('node:crypto');
const jobNumber = href => { try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'www.zhaopin.com' ? u.pathname.match(/^\/jobdetail\/([a-z0-9]+)\.html?$/i)?.[1].toUpperCase() || '' : ''; } catch { return ''; } };
const sessionId = href => { try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'i.zhaopin.com' && /^\/im\/?$/.test(u.pathname) ? u.searchParams.get('sessionId') || u.searchParams.get('sessionid') || '' : ''; } catch { return ''; } };
// In-memory provenance from the exact job's native Continue -> window.open -> IM session.
// Several jobs may share one recruiter conversation; its decorative header may show an older job.
function createZhaopinNativeChatBindings({ now = Date.now, nonce = randomUUID } = {}) {
  const guests = new Set(), armed = new Map(), bindings = new Map();
  const failed = () => ({ ok: false, error: '原生“继续沟通”的岗位与会话关联未确认' });
  return {
    attachGuest(wc) { guests.add(wc.id); },
    releaseGuest(id) { guests.delete(id); armed.delete(id); bindings.delete(id); },
    arm(wc, jobUrl) {
      const expected = jobNumber(jobUrl);
      armed.delete(wc.id); bindings.delete(wc.id);
      if (!guests.has(wc.id) || !expected || jobNumber(wc.getURL()) !== expected) return failed();
      const token = nonce(); armed.set(wc.id, { jobNumber: expected, token, expiresAt: now() + 45000 });
      return { ok: true, nativeChatToken: token };
    },
    captureWindowOpen(wc, href) {
      const pending = armed.get(wc.id), target = sessionId(href);
      if (!pending || !guests.has(wc.id) || pending.expiresAt <= now()) return false;
      if (jobNumber(wc.getURL()) !== pending.jobNumber) { armed.delete(wc.id); return false; }
      if (!target) return false;
      bindings.set(wc.id, { ...pending, sessionId: target, expiresAt: now() + 90000 });
      armed.delete(wc.id); return true;
    },
    verify(wc, { jobUrl, nativeChatToken, expectedSessionId } = {}) {
      const binding = bindings.get(wc.id);
      if (!guests.has(wc.id) || !binding || binding.expiresAt <= now() || !nativeChatToken || nativeChatToken !== binding.token
        || jobNumber(jobUrl) !== binding.jobNumber || expectedSessionId !== binding.sessionId || sessionId(wc.getURL()) !== binding.sessionId) return failed();
      return { ok: true, source: 'native-continue', jobNumber: binding.jobNumber, sessionId: binding.sessionId, expiresAt: binding.expiresAt };
    },
  };
}
module.exports = { createZhaopinNativeChatBindings };
