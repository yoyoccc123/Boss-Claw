import type { JobMeta } from './types';

export interface CompanySizeRange { label: string; low: number; high: number }

export function parseCompanySize(value: unknown): CompanySizeRange | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[,，\s]/g, '').replace(/～|~|—|–|至/g, '-');
  const range = text.match(/(\d+)-(\d+)人/);
  if (range && +range[2] >= +range[1]) return { label: `${+range[1]}-${+range[2]}人`, low: +range[1], high: +range[2] };
  const below = text.match(/(?:少于|不足|小于)(\d+)人|(\d+)人(?:以下|以内)/);
  if (below) { const n = +(below[1] || below[2]); return { label: `${n}人以下`, low: 0, high: n }; }
  const above = text.match(/(\d+)人(?:以上|及以上|起)/);
  if (above) return { label: `${+above[1]}人以上`, low: +above[1], high: Infinity };
  const exact = text.match(/^(?:公司规模[:：]?|公司人数[:：]?|员工人数[:：]?)?(\d+)人$/);
  return exact ? { label: `${+exact[1]}人`, low: +exact[1], high: +exact[1] } : null;
}

export function companySizeOfJob(job: JobMeta): CompanySizeRange | null {
  for (const value of [job.companySize, job.scaleName]) { const range = parseCompanySize(value); if (range) return range; }
  // JD 中的招聘人数、项目团队人数不代表公司规模，只接受明确的公司规模标签。
  const label = `${job.cardText || ''}\n${job.description || ''}`.match(/(?:公司规模|公司人数|员工人数)\s*[：:]?\s*([^\r\n·；;]{1,30})/);
  return label ? parseCompanySize(label[1]) : null;
}
