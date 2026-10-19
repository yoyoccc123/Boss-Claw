'use strict';
// Captured native job-apply widget (2026-10-19): checkParams sends these two
// fields to /application. Inspect before networking; never log the request body,
// which also contains platform credentials and resume metadata.
function isZhaopinApplication(details) {
  try {
    const url = new URL(details.url);
    return /^(POST|PUT|PATCH)$/i.test(details.method || '') && url.protocol === 'https:'
      && /(^|\.)zhaopin\.com$/i.test(url.hostname) && /^\/c\/pc\/alan\/jobs\/application\/?$/.test(url.pathname);
  } catch { return false; }
}
function inspectZhaopinAttachment(details) {
  if (!isZhaopinApplication(details)) return { applies: false, allowed: true };
  const denied = { applies: true, allowed: false, message: '已阻止智联在线简历投递：本程序仅允许附件简历；请在智联选择可用附件后重试' };
  try {
    const parts = details.uploadData;
    if (!Array.isArray(parts) || !parts.length || parts.some(p => !p.bytes || p.file || p.blobUUID)) return denied;
    const bytes = Buffer.concat(parts.map(p => Buffer.from(p.bytes)));
    if (!bytes.length || bytes.length > 1024 * 1024) return denied;
    const body = JSON.parse(bytes.toString('utf8'));
    const fileId = body?.attachmentDefaultFileId;
    return body?.attachmentDefaultType === 'attachment' && ['string', 'number'].includes(typeof fileId)
      && String(fileId).trim() && !['0', 'null', 'undefined'].includes(String(fileId).trim())
      ? { applies: true, allowed: true } : denied;
  } catch { return denied; }
}
function createZhaopinAttachmentPolicy() {
  const installed = new WeakSet(), states = new Map();
  const initial = () => ({ ok: true, blocked: false, allowedRequests: 0 });
  return {
    install(browserSession) {
      if (installed.has(browserSession)) return;
      // Keep this the session's only onBeforeRequest dispatcher. Other event
      // types (e.g. onBeforeSendHeaders) retain their existing listeners.
      browserSession.webRequest.onBeforeRequest({ urls: ['https://*.zhaopin.com/c/pc/alan/jobs/application*'] }, (details, callback) => {
        const decision = inspectZhaopinAttachment(details);
        if (decision.applies) {
          const state = states.get(details.webContentsId) || initial();
          if (decision.allowed) state.allowedRequests++;
          else { state.blocked = true; state.message = decision.message; }
          states.set(details.webContentsId, state);
        }
        callback({ cancel: !decision.allowed });
      });
      installed.add(browserSession);
    },
    begin(wc) {
      if (!installed.has(wc.session)) return { ok: false, message: '智联附件投递保护未就绪，未点击投递' };
      states.set(wc.id, initial()); return initial();
    },
    read(wc) {
      return installed.has(wc.session) && states.has(wc.id) ? { ...states.get(wc.id) }
        : { ok: false, message: '智联附件投递状态未就绪' };
    },
    release(id) { states.delete(id); },
  };
}
module.exports = { isZhaopinApplication, inspectZhaopinAttachment, createZhaopinAttachmentPolicy };
