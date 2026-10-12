import type { JobMeta, PendingItem } from './types';

export const ZHAOPIN_LINK_ERROR = '智联岗位详情链接未采集完整，请重新采集该岗位后再确认投递';

export function zhaopinJobNumber(value: unknown): string {
  const raw = String(value || '').trim();
  const part = raw.match(/jobdetail\/([^/?#]+)/i)?.[1] || raw;
  const number = part.replace(/\.html?$/i, '');
  return /^[A-Za-z]{2,4}\d+J\d+$/.test(number) ? number : '';
}

/** Public platform numbers can restore a link; fallback hashes can never do so. */
export function resolveJobDetailUrl(job: JobMeta): string {
  const raw = String(job.url || '').trim();
  if (job.platform !== 'zhaopin') return raw;
  for (const value of [raw, job.positionUrl, job.positionURL, job.detailUrl]) {
    if (!value) continue;
    try {
      const url = new URL(String(value), 'https://www.zhaopin.com');
      if (/^(?:www\.)?zhaopin\.com$/i.test(url.hostname) && /^https?:$/.test(url.protocol) && /^\/jobdetail\//i.test(url.pathname) && zhaopinJobNumber(url.pathname)) return url.href;
    } catch { /* Try a verified platform number below. */ }
  }
  const number = [job.jobId, job.number, job.positionNumber].map(zhaopinJobNumber).find(Boolean);
  return number ? `https://www.zhaopin.com/jobdetail/${number}.htm` : '';
}

export function isSalaryOnlyTitle(title: unknown): boolean {
  return /^\s*\d+(?:\.\d+)?(?:\s*[-–—~至到]\s*\d+(?:\.\d+)?)?\s*(?:[Kk]|万|千|元(?:\s*\/\s*(?:天|日|月|时|年))?)\s*(?:以上|以下)?\s*(?:[·*＊xX×]\s*1[2-8]\s*薪)?\s*$/.test(String(title || ''));
}

export function isZhaopinCardFragment(job: JobMeta): boolean {
  return job.platform === 'zhaopin' && (isSalaryOnlyTitle(job.title) || (!resolveJobDetailUrl(job) && !String(job.company || '').trim()));
}

export function normalizeJobDetailMetadata(job: JobMeta): JobMeta {
  if (job.platform !== 'zhaopin') return job;
  const url = resolveJobDetailUrl(job);
  const jobId = url ? zhaopinJobNumber(url) : '';
  return url && (url !== job.url || jobId !== job.jobId) ? { ...job, url, jobId } : job;
}

/** Keep incomplete records, but remove them from the sending queue. */
export function repairZhaopinPending(items: PendingItem[]): PendingItem[] {
  return items.map(item => {
    if (item.job?.platform !== 'zhaopin') return item;
    const job = normalizeJobDetailMetadata(item.job);
    if ((!resolveJobDetailUrl(job) || isZhaopinCardFragment(job)) && (item.status === 'approved_queue' || item.status === 'approved')) {
      return { ...item, job, status: 'failed' as const, error: ZHAOPIN_LINK_ERROR, retryable: false, linkIncomplete: true };
    }
    return job !== item.job ? { ...item, job } : item;
  });
}
