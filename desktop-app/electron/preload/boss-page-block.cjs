'use strict';

// Read the platform's stop instruction; never retry or dismiss a challenge.
function readBossPageBlock(url, text = '', now = Date.now()) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)zhipin\.com$/i.test(u.hostname)) return null;
  const body = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const restricted = /\/passport\/zp\/403\.html$/i.test(u.pathname)
    || /您的账户存在异常行为|已暂时被限制访问/.test(body)
    || (/访问受限/.test(body) && /暂时无法访问此页面|恢复正常/.test(body));
  const challenge = /verify-slider|zpsecureflow\/captcha|passport\/zp\/verify|security-check/i.test(u.pathname)
    || /请完成安全验证|请先完成验证|确认您是真人/.test(body);
  const rateLimited = /请求过于频繁|访问过于频繁|操作过于频繁/.test(body);
  const abnormal = /账户异常|账号异常/.test(body);
  if (!restricted && !challenge && !rateLimited && !abnormal) return null;
  const code = restricted ? 32 : rateLimited ? 1006 : abnormal ? 36 : 35;
  const fallbackMinutes = code === 32 ? 120 : code === 36 ? 60 : code === 1006 ? 10 : 30;
  const date = body.match(/将于\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*恢复/);
  let until = 0;
  if (date) {
    const parts = date.slice(1).map(v => Number(v || 0));
    const [y, m, d, h, min, sec] = parts;
    const stamp = Date.UTC(y, m - 1, d, h - 8, min, sec);
    const local = new Date(stamp + 8 * 3600_000);
    if (local.getUTCFullYear() === y && local.getUTCMonth() === m - 1 && local.getUTCDate() === d
      && h < 24 && min < 60 && sec < 60 && stamp > now - 86400_000 && stamp - now <= 31 * 86400_000) until = stamp;
  }
  return { code, explicitUntil: !!until,
    until: until || now + fallbackMinutes * 60_000,
    message: code === 32 ? 'BOSS 访问受限，已停止自动访问；请等待平台恢复后手动继续'
      : code === 1006 ? 'BOSS 提示请求过于频繁，已停止自动访问并进入退避'
      : code === 36 ? 'BOSS 提示账户异常，已停止自动访问，请人工核对'
      : 'BOSS 需要人工安全验证，已停止自动访问' };
}
module.exports = { readBossPageBlock };
