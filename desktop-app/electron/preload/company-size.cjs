'use strict';
function companySizeLabel(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[,，\s]/g, '').replace(/～|~|—|–|至/g, '-');
  for (const match of text.matchAll(/\d+-\d+人|(?:少于|不足|小于)\d+人|\d+人(?:以下|以内|以上|及以上)/g)) {
    if (!/招|团队|项目|部门/.test(text.slice(Math.max(0, match.index - 10), match.index))) return match[0];
  }
  return '';
}
function companySizeFromPayload(payload) {
  const root = payload?.zpData || payload?.data || payload || {};
  for (const object of [root, root.brandComInfo, root.brandInfo, root.company, root.companyInfo, root.detailedPosition, root.detailedPosition?.company, root.detailedPosition?.companyInfo, root.jobInfo]) {
    for (const key of ['scaleName', 'companySize', 'companySizeName', 'staffSize', 'compScale', 'companyScale']) {
      const label = companySizeLabel(object?.[key]); if (label) return label;
    }
  }
  return '';
}
function companySizeFromDocument(doc) {
  for (const selector of ['.company-info', '.company-scale', '[class*="company-size"]', '[class*="companySize"]', '[class*="companyScale"]', '[data-selector="company-info"]', '[data-selector="company-info-wrapper"]']) {
    for (const element of doc?.querySelectorAll?.(selector) || []) {
      const label = companySizeLabel(element.innerText || element.textContent || ''); if (label) return label;
    }
  }
  const text = doc?.body?.innerText || doc?.body?.textContent || '';
  const match = text.match(/(?:公司规模|公司人数|员工人数)\s*[：:]?\s*([^\r\n]{1,30})/);
  return companySizeLabel(match?.[1] || '');
}
module.exports = { companySizeLabel, companySizeFromPayload, companySizeFromDocument };
