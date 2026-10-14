'use strict';
// BOSS v2's image toolbar is btn-sendimg; substring matching btn-send opens a file picker.
function isTextSendControl(el) {
  if (!el || !el.isConnected || !/^(BUTTON|DIV|A|SPAN)$/.test(el.tagName || '')) return false;
  const text = String(el.innerText || el.textContent || '').replace(/\s+/g, '').trim();
  const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-tip')].filter(Boolean).join(' ');
  if (text !== '发送' || /图片|附件|简历|上传|image|attach|upload|resume|file/i.test(label)) return false;
  if (/(?:send[-_]?(?:img|image|file|attach|resume)|upload)/i.test(String(el.className || ''))) return false;
  if (el.querySelector('input[type="file"]') || el.closest('label, [data-upload], .btn-sendimg')) return false;
  return true;
}
function findTextSendButton(doc, input, options = {}) {
  if (!input?.isConnected) return null;
  const scope = input.closest('.chat-conversation, .startchat-content, [class*="startchat"], [role="dialog"]')
    || input.closest('.message-controls, [class*="edit-area"], [class*="editArea"], [class*="input-box"], .chat-editor');
  if (!scope) return null;
  const candidates = [...scope.querySelectorAll('button, [role="button"], .send-message, .sendMessage, .send-btn, .btn-send, .sendBtn, .chatSend, .chat-send')].filter(el => {
    if (!isTextSendControl(el)) return false;
    const rect = el.getBoundingClientRect(), style = doc.defaultView.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      && (options.allowDisabled || !(el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\s)disable(d)?(\s|$)/i.test(String(el.className || ''))));
  });
  return candidates.length === 1 ? candidates[0] : null;
}
function readTextSendTarget(doc, expected = {}) {
  const fail = reason => ({ ready: false, reason });
  const input = doc.querySelector('.chat-conversation #chat-input[contenteditable="true"]');
  if (!input?.isConnected) return fail('文字输入框已改变');
  if (expected.action === 'insertText' || expected.action === 'pressEnter') {
    if (doc.activeElement !== input && !input.contains(doc.activeElement)) return fail('当前焦点不在文字输入框，已取消输入或发送');
    if (expected.action === 'insertText') return { ready: true };
  }
  const normalize = value => String(value || '').replace(/[\u200b\u200c\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!normalize(expected.greeting) || normalize(input.innerText || input.textContent) !== normalize(expected.greeting)) return fail('草稿与本岗位招呼语不一致，已取消发送');
  if (expected.action === 'pressEnter') return { ready: true };
  if (expected.action !== 'clickAt' || !expected.marker) return fail('文字发送目标缺失，已取消点击');
  const buttons = [...doc.querySelectorAll('[data-bossclaw-text-send]')].filter(e => e.getAttribute('data-bossclaw-text-send') === expected.marker);
  const button = buttons.length === 1 ? buttons[0] : null;
  if (!button || findTextSendButton(doc, input) !== button) return fail('文字发送按钮已改变或不可用，已取消点击');
  const rect = button.getBoundingClientRect(), x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
  const view = doc.defaultView;
  if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return fail('文字发送按钮不在视口内');
  const hit = doc.elementFromPoint(x, y);
  if (!hit || (hit !== button && !button.contains(hit)) || hit.closest('label, input[type="file"], .btn-sendimg')) return fail('文字发送按钮被遮挡，已取消点击');
  return { ready: true, x, y };
}
function buildTextSendTargetScript(expected) {
  return `(()=>{const isTextSendControl=${isTextSendControl.toString()};const findTextSendButton=${findTextSendButton.toString()};return (${readTextSendTarget.toString()})(document,${JSON.stringify(expected)});})()`;
}
module.exports = { isTextSendControl, findTextSendButton, readTextSendTarget, buildTextSendTargetScript };
