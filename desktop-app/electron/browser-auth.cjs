'use strict';
// Shared by the login indicator and persistence observer. Short token names match exactly.
const WEBVIEW_AUTH_COOKIE_HINTS = {
  boss: ['wt2'],
  liepin: ['lp_login', 'lp_token', 'token'],
  zhaopin: ['zp_auto', 'zp_sign', 'swordman', 'zm_job_pc', ['=at', '=rt']],
  job51: ['j_ticket', 'sajssp', '51job', 'job51'],
  wuba: ['=ppu'],
};
const WEBVIEW_PLATFORM_DOMAIN = {
  boss: 'zhipin.com', liepin: 'liepin.com', zhaopin: 'zhaopin.com', job51: '51job.com', wuba: '58.com',
};
function cookiePlatform(cookie) {
  const name = String(cookie?.name || '').toLowerCase();
  const domain = String(cookie?.domain || '').toLowerCase().replace(/^\.+/, '');
  for (const [platform, suffix] of Object.entries(WEBVIEW_PLATFORM_DOMAIN)) {
    if (domain !== suffix && !domain.endsWith('.' + suffix)) continue;
    const patterns = WEBVIEW_AUTH_COOKIE_HINTS[platform].flat();
    if (platform === 'wuba') patterns.push('=ppu.sig', '=cloudpassport', '=passportaccount');
    if (patterns.some(p => p.startsWith('=') ? name === p.slice(1) : name.includes(p))) return platform;
  }
  return null;
}
module.exports = { WEBVIEW_AUTH_COOKIE_HINTS, WEBVIEW_PLATFORM_DOMAIN, cookiePlatform };
