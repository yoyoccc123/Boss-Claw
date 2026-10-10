'use strict';
const OFFICE = require('./office-address.cjs');
const COMPANY = require('./company-size.cjs');
const ADAPTERS = require('./platform-adapters.cjs');

/** 仅 GET 职位详情；沿用当前平台登录态，不导航、不沟通、不投递。 */
async function readOfficeAddress(job, context) {
  let url;
  try { url = new URL(job?.url); } catch { return { error: '岗位链接无效' }; }
  const platform = ADAPTERS.detectPlatform(url.hostname);
  if (!/(^|\.)(zhipin\.com|liepin\.com|zhaopin\.com|51job\.com)$/.test(url.hostname)) return { error: '岗位链接不属于支持的招聘平台' };
  if (!['boss', 'zhaopin', 'liepin', 'job51'].includes(platform) || platform !== context.platform ||
      (job.platform && job.platform !== platform) || !/^https?:$/.test(url.protocol)) return { error: '请在对应招聘平台的标签页补齐地址' };
  const problem = (response) => {
    const code = Number(response?.code);
    const error = String(response?.error || '');
    if ([17, 32, 35, 36, 37, 38].includes(code) || /HTTP (?:401|403|429)/.test(error)) {
      return { stop: true, error: '平台要求登录、验证或限制请求，请处理后再补齐地址' };
    }
    return null;
  };
  let companySize = '';
  let knownAddress = '';
  if (platform === 'boss') {
    const id = ADAPTERS.jobIdFromUrl(url.href) || String(job.jobId || '');
    if (!id) return { error: '链接缺少岗位编号' };
    for (const endpoint of ['detail', 'card']) {
      const response = await context.fetchJson(`/wapi/zpgeek/job/${endpoint}.json?encryptJobId=${encodeURIComponent(id)}`);
      const blocked = problem(response); if (blocked) return blocked;
      if (response?.code === 0) {
        companySize = COMPANY.companySizeFromPayload(response) || companySize;
        const address = OFFICE.officeAddressFromPayload(response);
        knownAddress = address || knownAddress;
        if (knownAddress && companySize) return { address: knownAddress, companySize };
      }
    }
  } else if (platform === 'zhaopin') {
    const number = ADAPTERS.zhaopinJobNumber(job.jobId || url.href);
    if (number) {
      const result = await context.fetchSource(ADAPTERS.zhaopinJobDetailUrl(number), 'json');
      const blocked = problem(result.data || result); if (blocked) return blocked;
      if (!result.ok) return { error: result.error };
      companySize = COMPANY.companySizeFromPayload(result.data);
      const address = OFFICE.officeAddressFromPayload(result.data);
      knownAddress = address;
      if (knownAddress && companySize) return { address: knownAddress, companySize };
    }
  }
  const result = await context.fetchSource(url.href, 'text');
  const blocked = problem(result); if (blocked) return blocked;
  if (!result.ok) return { address: knownAddress, companySize, error: result.error };
  const doc = context.parseHtml(result.data);
  const address = OFFICE.officeAddressFromDocument(doc) || knownAddress;
  companySize = COMPANY.companySizeFromDocument(doc) || companySize;
  if (address) return { address, companySize };
  if (/安全验证|访问过于频繁|请完成验证|请先登录/.test(String(doc.body?.textContent || ''))) {
    return { stop: true, error: '详情页要求登录或验证，请处理后再试' };
  }
  return { address: '', companySize };
}
module.exports = { readOfficeAddress };
