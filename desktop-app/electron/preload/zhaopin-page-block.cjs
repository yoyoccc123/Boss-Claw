'use strict';

// Read-only classification. A challenge is handed to the user; no challenge controls are clicked.
const HUMAN_TEXT = /人机(?:验证|校验)|安全验证|请完成.{0,8}验证|拖动.{0,8}滑块|滑动验证|向右滑动|行为异常|访问受限|操作频繁/;
const CHALLENGE_TEXT = /人机(?:验证|校验)|拖动.{0,8}滑块|滑动验证|向右滑动|点击.{0,8}(?:图片|文字)/;
const SMS_TEXT = /短信(?:验证|验证码)|手机验证码|验证码已(?:发送|发至)|发送短信/;
const JOB_TEXT = /职位描述|岗位职责|工作职责|任职要求|职位要求|公司介绍|工作地点/;
const FIELD = 'input, textarea, select, [contenteditable="true"]';
const JOB_SCOPE = '[class*="job-description"], [class*="job-desc"], .describtion';
const LOGIN_SCOPE = '[class*="login"], [class*="passport"], .a-job-apply-not-login-panel, [class*="not-login-panel"]';
const WIDGETS = '[class*="geetest"], [class*="waf"], [class*="captcha"], [id*="captcha"], [class*="nc-container"], [class*="nc_wrapper"]';

function visible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  try {
    const view = el.ownerDocument.defaultView;
    for (let parent = el; parent && parent.nodeType === 1; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      // Native Vue's enter frame can stay at opacity 0 while the guest is
      // backgrounded. Its mounted workflow remains actionable by DOM; read
      // verification panels in it too, before allowing any attachment action.
      if (Number(style.opacity) === 0 && !(el.ownerDocument.visibilityState === 'hidden'
        && parent.matches('.a-modal.a-modal--transition-enter.a-modal--transition-enter-active')
        && parent.querySelector('.a-job-apply-workflow'))) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  } catch { return false; }
}
// An empty rendered string must stay empty: textContent includes hidden login
// templates that the site keeps mounted behind its normal navigation/chat UI.
const text = el => String(typeof el?.innerText === 'string' ? el.innerText : el?.textContent || '').replace(/\s+/g, '').trim();
function challengeUrl(value) {
  try {
    const url = new URL(value, 'https://www.zhaopin.com');
    return /pwaf_challenge|security[-_/]check|captcha|geetest/i.test(url.hostname + url.pathname);
  } catch { return false; }
}
const risk = source => ({ kind: 'risk', source, message: '检测到人机验证或安全验证，已暂停投递并保留页面，请手动完成验证后再继续' });
const login = source => ({ kind: 'login', source, message: '智联页面需要登录或短信验证，已暂停并保留页面，请在当前页面手动完成' });

function readZhaopinPageBlock(doc, href, spec = {}, { missingAction = false } = {}) {
  if (challengeUrl(href)) return risk('verification-url');
  const roots = [doc], visited = new Set();
  const selectors = [...(spec.riskScopeSelectors || []), '[role="dialog"]', '[aria-modal="true"]', '.ant-modal', '.ant-message', '.ant-notification'];
  const riskTexts = spec.riskTexts || ['安全验证', '请完成验证', '验证码', '行为异常'];
  for (let i = 0; i < roots.length && i < 20; i++) {
    const root = roots[i];
    if (!root || visited.has(root)) continue;
    visited.add(root);
    for (const frame of root.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      if (challengeUrl(frame.getAttribute('src') || '') || HUMAN_TEXT.test(frame.getAttribute('title') || '')) return risk('verification-frame');
      try { if (frame.contentDocument?.body) roots.push(frame.contentDocument); } catch { /* Cross-origin DOM stays inaccessible. */ }
    }
    for (const el of root.querySelectorAll(WIDGETS)) {
      if (!visible(el) || el.matches(FIELD) || el.closest(JOB_SCOPE)) continue;
      const words = text(el);
      const loginContext = el.closest(LOGIN_SCOPE);
      const fingerprint = String(el.id || '') + ' ' + String(el.className || '');
      if (loginContext && !CHALLENGE_TEXT.test(words) && !/geetest|waf|nc-container|nc_wrapper/i.test(fingerprint)) continue;
      if ((/geetest|waf|nc-container|nc_wrapper/i.test(fingerprint) && (words || /panel|popup|slider|challenge|wrapper/i.test(fingerprint) || el.querySelector('canvas, img, iframe, svg, [class*="slider"]'))) || HUMAN_TEXT.test(words)
          || (riskTexts.some(t => words.includes(t)) && !el.querySelector(FIELD))
          || el.querySelector('canvas, img, iframe, [class*="slider"]')) return risk('verification-widget');
    }
    for (const el of root.querySelectorAll(selectors.join(', '))) {
      if (!visible(el) || el.matches(FIELD) || el.closest(JOB_SCOPE)) continue;
      const words = text(el);
      if (SMS_TEXT.test(words) && !CHALLENGE_TEXT.test(words)) return login('sms-panel');
      if (el.closest(LOGIN_SCOPE) && !CHALLENGE_TEXT.test(words)) continue;
      if (HUMAN_TEXT.test(words) || (!el.querySelector(FIELD) && riskTexts.some(t => words.includes(t)))) return risk('verification-panel');
    }
    for (const el of root.querySelectorAll(LOGIN_SCOPE)) {
      if (!visible(el) || el.closest(JOB_SCOPE)) continue;
      const words = text(el);
      if (/登录|注册/.test(words) && (el.matches('.a-job-apply-not-login-panel, [class*="not-login-panel"], [role="dialog"]')
          || Array.from(el.querySelectorAll('input:not([type="hidden"]), form, [class*="qrcode"], [class*="qr-code"]')).some(visible))) return login('login-panel');
    }
    // Full-page evidence is used only when there is no action and no job-description structure.
    if (missingAction && !Array.from(root.querySelectorAll(JOB_SCOPE)).some(visible)) {
      const words = text(root.body);
      if (words.length < 1600 && !JOB_TEXT.test(words)) {
        if (HUMAN_TEXT.test(words)) return risk('verification-interstitial');
        // Navigation's login/register link is not a login wall. This fallback
        // needs an explicit instruction; visible forms/QR panels are read above.
        if (/请先登录|请(?:使用.{0,24})?扫码登录|登录后才能|请(?:先)?(?:完成|进行)(?:登录|短信验证)/.test(words)) return login('login-interstitial');
      }
    }
  }
  return null;
}

module.exports = { readZhaopinPageBlock };
