import type { AppConfig, JobMeta, JobPlatform, PendingItem } from './types';

export const DEFAULT_PENDING_TARGET = 50;
export const MAX_PENDING_TARGET = 1000;
export type DailyCollectionCounts = Partial<Record<JobPlatform, { date: string; count: number; identities?: string[] }>>;
const platforms: JobPlatform[] = ['boss', 'liepin', 'zhaopin', 'job51'];

// The recruiting day follows the user's China timezone, including when Windows uses another zone.
export const collectionDay = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
export function collectionIdentity(job: JobMeta): string {
  const id = String(job.jobId || '').trim().toLowerCase().replace(/\.html?$/i, '');
  const url = String(job.url || '').split(/[?#]/)[0].trim().toLowerCase();
  return `${job.platform || 'boss'}:${id || url || [job.title, job.company, job.salary, job.location].map(v => String(v || '').trim().toLowerCase()).join('|')}`;
}
export function normalizePendingTarget(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_PENDING_TARGET, Math.floor(n)) : DEFAULT_PENDING_TARGET;
}
export function pendingTargetFor(config: AppConfig, platform: JobPlatform): number {
  const p = config.platforms?.[platform];
  return normalizePendingTarget(p?.pendingTarget ?? p?.dailyTarget);
}
export function isQualifiedPending(item: PendingItem): boolean {
  const a = item.analysis;
  return !!a && ['recommend', 'cautious'].includes(a.decision) && Number.isFinite(a.score) && a.score >= 0 && a.score <= 100
    && !(a.hardBlocks || []).length;
}
export function collectionCountFor(pending: PendingItem[], counts: DailyCollectionCounts, platform: JobPlatform, now = Date.now()): number {
  const date = collectionDay(now), saved = counts?.[platform];
  const existing = pending.filter(p => (p.job.platform || 'boss') === platform && Number.isFinite(p.createdAt)
    && collectionDay(p.createdAt) === date && isQualifiedPending(p)).length;
  return Math.max(existing, saved?.date === date ? Math.max(0, Math.floor(Number(saved.count) || 0)) : 0);
}
export function seedCollectionCounts(pending: PendingItem[], counts: DailyCollectionCounts = {}, now = Date.now()): DailyCollectionCounts {
  const date = collectionDay(now);
  return Object.fromEntries(platforms.map(p => [p, { date, count: collectionCountFor(pending, counts, p, now),
    identities: [...new Set([...(counts?.[p]?.date === date ? counts[p]?.identities || [] : []),
      ...pending.filter(item => (item.job.platform || 'boss') === p && Number.isFinite(item.createdAt) && collectionDay(item.createdAt) === date && isQualifiedPending(item)).map(item => collectionIdentity(item.job))])],
  }]));
}
export function collectionGoal(config: AppConfig, pending: PendingItem[], counts: DailyCollectionCounts, platform: JobPlatform, now = Date.now()) {
  const target = pendingTargetFor(config, platform), count = collectionCountFor(pending, counts, platform, now);
  return { date: collectionDay(now), target, count, reached: count >= target, remaining: Math.max(0, target - count) };
}
