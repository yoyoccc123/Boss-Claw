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
module.exports = { searchScopeMatches, explicitlyEmpty };
