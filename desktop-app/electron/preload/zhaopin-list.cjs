'use strict';

// Runs in the page's main world. Read only the model belonging to this card,
// never an SSR array position or another card's selected-job data.
function readZhaopinCardModel(card) {
  const norm = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const vm = card?.__vue__, job = vm?.$props?.job;
  if (!job || vm.$options?.name !== 'JobCard') return null;
  const title = norm(job.name || job.positionName), company = norm(job.companyName);
  const number = norm(job.number || job.positionNumber);
  if (!title || !company || !/^[A-Za-z]{2,4}\d+J\d+$/.test(number)) return null;
  const renderedCompany = norm(card.querySelector('.job-card__company-name')?.textContent);
  const clamp = card.querySelector('.vue-clamp')?.__vue__;
  const clampTitle = norm(clamp?.$props?.content);
  if ((renderedCompany && renderedCompany !== company) || (clampTitle && clampTitle !== title)) return null;
  const link = job.positionURL || job.positionUrl;
  if (link) {
    try {
      const url = new URL(link);
      if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)zhaopin\.com$/i.test(url.hostname)
        || url.pathname.replace(/\.html?$/i, '') !== '/jobdetail/' + number) return null;
    } catch { return null; }
  }
  return { title, company, number, url: 'https://www.zhaopin.com/jobdetail/' + number + '.htm' };
}

// Legacy /sou/jl763/p1 redirects to /jobs/?jl=763. Compare the actual search
// dimensions, so a ready response from the previous keyword cannot admit it.
function searchScopeMatches(actual, expected) {
  try {
    const parse = raw => {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || !/(^|\.)zhaopin\.com$/i.test(u.hostname)
        || !/^\/(?:sou\/|jobs\/?$)/i.test(u.pathname)) return null;
      const p = u.searchParams, legacyCity = u.pathname.match(/\/jl(\d+)(?:\/|$)/i)?.[1];
      const values = k => (p.get(k) || '').split(',').filter(Boolean).sort().join(',');
      return [(p.get('kw') || '').trim(), p.get('jl') || legacyCity || '', values('el'), values('et')];
    };
    const a = parse(actual), e = parse(expected);
    return !!a && !!e && JSON.stringify(a) === JSON.stringify(e);
  } catch { return false; }
}
module.exports = { readZhaopinCardModel, searchScopeMatches };
