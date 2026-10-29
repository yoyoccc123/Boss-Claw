'use strict';

function searchScopeMatches(actual, expected, doc) {
  try {
    const parse = raw => {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || !/(^|\.)liepin\.com$/i.test(u.hostname) || u.pathname !== '/zhaopin/') return null;
      return ['key', 'city', 'dq', 'salaryCode', 'workYearCode', 'eduLevel', 'compScale', 'compKind', 'pubTime', 'compStage'].map(k => u.searchParams.get(k) || '');
    };
    const a = parse(actual), e = parse(expected);
    if (!a || !e || JSON.stringify(a) !== JSON.stringify(e)) return false;
    const input = doc?.querySelector('input[placeholder="搜索职位、公司"]');
    return !input || input.value.trim() === e[0].trim();
  } catch { return false; }
}

function explicitlyEmpty(doc, url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)liepin\.com$/i.test(u.hostname) || u.pathname !== '/zhaopin/') return false;
    const body = String(doc.body?.innerText || '');
    if (/安全验证|验证码|操作频繁|访问受限|异常访问|请先登录/.test(body)) return false;
    return Array.from(doc.querySelectorAll('.content-left-section .ant-empty-description')).some(el =>
      el.getClientRects().length > 0 && /^非常抱歉[！!]?\s*暂时没有合适的职位[。！!]?$/u.test(el.textContent.trim()));
  } catch { return false; }
}
function readPageBlock(doc, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)liepin\.com$/i.test(u.hostname)) return null;
  const query = (root, selector) => { try { return Array.from(root.querySelectorAll(selector)); } catch { return []; } };
  const text = el => String(typeof el?.innerText === 'string' ? el.innerText : el?.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = el => {
    try {
      for (let node = el; node; node = node.parentElement) {
        const css = node.ownerDocument.defaultView.getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || css.display === 'none'
          || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch { return false; }
  };
  // Match the current host/path; query text and return URLs are not evidence.
  if (/\/(?:verify|captcha|validate)(?:[/.]|$)/i.test(u.pathname)
    || /^(?:captcha|verify)\./i.test(u.hostname))
    return { kind: 'risk', source: 'verify-url', message: '猎聘页面需要人工完成安全验证' };
  const challengeText = /确认您是(?:真人|本人)|安全验证|人机验证|请完成验证|请先验证|拖动滑块|滑动验证|访问受限|操作过于频繁/;
  const dialogs = query(doc, '[role="dialog"], .ant-modal, [class*="captcha"], [class*="verify"], [class*="geetest"]');
  if (dialogs.some(el => shown(el) && challengeText.test(text(el))))
    return { kind: 'risk', source: 'verify-dialog', message: '猎聘页面需要人工完成安全验证' };
  if (query(doc, 'h1, h2, [role="heading"]').some(el => shown(el)
    && /^(?:安全验证|人机验证|访问受限|请完成安全验证|确认您是真人)[！!。]?$/u.test(text(el))))
    return { kind: 'risk', source: 'verify-heading', message: '猎聘页面需要人工完成安全验证' };
  if (/^(?:passport|login)\./i.test(u.hostname) || /\/(?:login|signin|sign-in)(?:[/.]|$)/i.test(u.pathname))
    return { kind: 'login', source: 'auth-url', message: '猎聘已跳转到登录页面' };
  for (const root of query(doc, 'form, [role="dialog"], .ant-modal, [class*="login"], [class*="Login"]')) {
    if (!shown(root)) continue;
    const credential = query(root, 'input').some(el => shown(el) && !el.disabled && (el.type === 'password' || el.type === 'tel'
      || /手机号|手机号码|邮箱|phone|mobile|email/i.test([el.name, el.getAttribute('placeholder'), el.getAttribute('autocomplete')].join(' '))));
    const login = query(root, 'button, a, [role="button"], input[type="submit"]').some(el => shown(el)
      && /^(?:同意(?:协议)?并)?(?:立即登录|安全登录|验证码登录|密码登录|登录|登录[\/／]注册|注册[\/／]登录)$/u.test(text(el) || el.value || ''));
    if (credential && login) {
      const loading = query(doc, '[class*="skeleton"], [class*="loading"], [class*="mask"], [class*="overlay"]').some(el => {
        if (!shown(el)) return false;
        const r = el.getBoundingClientRect(), view = el.ownerDocument.defaultView;
        return r.width > view.innerWidth * 0.55 && r.height > view.innerHeight * 0.45;
      });
      return { kind: 'login', source: 'login-form', loading, message: '猎聘页面显示可见的账号登录表单' };
    }
  }
  return null;
}

function createLoginConfirmation(clock = Date.now, settleMs = 1500) {
  let key = '', since = null;
  return ({ block, url, readyState, cards = 0, loading = false }) => {
    if (block?.kind !== 'login' || Number(cards) > 0) { key = ''; since = null; return false; }
    if (block.source === 'auth-url') return true;
    if (readyState !== 'complete' || loading || block.loading) { key = ''; since = null; return false; }
    const current = `${url}:${block.source}`;
    if (current !== key || since === null) { key = current; since = clock(); return false; }
    return clock() - since >= settleMs;
  };
}
module.exports = { searchScopeMatches, explicitlyEmpty, readPageBlock, createLoginConfirmation };
