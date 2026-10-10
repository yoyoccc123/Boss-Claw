'use strict';
// 只读提取平台明确给出的工作地址；不使用公司注册地址、公司名或城市名推断。
function cleanOfficeAddress(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    .replace(/^(?:工作地址|办公地址|公司地址)\s*[:：]?\s*/, '')
    .split(/查看地图|导航|附近地铁|点击查看|[【\[]|(?:任职要求|岗位职责|招聘要求|福利待遇|招聘人数)[：:】]?/)[0].trim().slice(0, 180);
}
function addressValue(value) {
  if (typeof value === 'string') return cleanOfficeAddress(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const detail = value.address || value.detailAddress || value.addressText || value.addressDetail;
  if (typeof detail !== 'string') return '';
  const parts = [value.cityName, value.areaDistrict || value.districtName, detail].filter(v => typeof v === 'string' && v.trim());
  return cleanOfficeAddress([...new Set(parts)].join(' '));
}
function officeAddressFromText(text) {
  const match = String(text || '').match(/(?:工作地址|办公地址|上班地址|公司地址|办公地点|上班地点|工作地点|公司地点)\s*[：:】\]]?\s*([^\r\n]{3,180})/);
  const result = cleanOfficeAddress(match?.[1] || '');
  return isDetail(result) ? result : '';
}
const isDetail = (value) => /路|街|巷|弄|号(?!线)|栋|幢|楼|大厦|中心|园|公寓|小区|民房|住宅|自建房/.test(value);
function officeAddressFromPayload(payload) {
  const root = payload?.zpData || payload?.data || payload || {};
  const candidates = [root.jobInfo, root.detailedPosition, root.position, root.job, root];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    // 根对象只接受职位专属字段，避免将公司注册地址当作办公地点。
    const keys = candidate === root ? ['workAddress', 'jobAddress', 'workplaceAddress', 'workAddr']
      : ['workAddress', 'jobAddress', 'workplaceAddress', 'workAddr', 'detailAddress', 'address', 'addressText'];
    for (const key of keys) {
      const address = addressValue(candidate[key]);
      if (isDetail(address)) return address;
    }
    const textAddress = officeAddressFromText(candidate.jobDesc || candidate.postDescription || candidate.description);
    if (textAddress) return textAddress;
  }
  return '';
}
function officeAddressFromDocument(doc) {
  if (!doc?.querySelectorAll) return '';
  const selectors = ['.job-location .location-address', '.job-location', '.work-address', '[class*="workAddress"]', '[class*="work-address"]', '[itemprop="jobLocation"]'];
  for (const selector of selectors) {
    for (const element of doc.querySelectorAll(selector)) {
      const address = cleanOfficeAddress(element.innerText || element.textContent || '');
      if (address && isDetail(address)) return address;
    }
  }
  return officeAddressFromText(doc.body?.innerText || doc.body?.textContent || '');
}
module.exports = { cleanOfficeAddress, officeAddressFromText, officeAddressFromPayload, officeAddressFromDocument };
