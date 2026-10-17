import type { AppConfig, JobMeta } from './types';
import type { JobPlatform } from './platforms';

export type CollectionStartMode = 'continue' | 'restart';
export interface CollectionCombination { keyword?: string; location?: string; employmentType?: string; url: string }
export interface CollectionCheckpoint {
  signature: string;
  index: number;
  keyword: string;
  location: string;
  processedKeys: string[];
  lastTitle: string;
  updatedAt: number;
  complete: boolean;
}
export type CollectionCheckpoints = Partial<Record<JobPlatform, CollectionCheckpoint>>;

// Only search/analysis criteria invalidate progress. Quotas, speed and platform priority do not.
export function collectionSignature(queue: CollectionCombination[], config: AppConfig): string {
  const criteria = ['hrActivityFilter', 'excludeHeadhunters', 'excludedProvinces', 'excludedCities', 'excludedCompanies',
    'excludedRecruiters', 'excludedJobDescKeywords', 'interviewModeFilter', 'minQueueScore', 'excludeExpiredJobs',
    'minSalaryMode', 'minSalaryPerDay', 'minSalaryPerMonth'];
  return JSON.stringify([queue.map(q => [q.keyword, q.location, q.employmentType, q.url]),
    criteria.map(k => (config as unknown as Record<string, unknown>)[k])]);
}
export function beginCollection<T extends CollectionCombination>(queue: T[], signature: string, saved?: CollectionCheckpoint,
  mode: CollectionStartMode = 'continue'): { checkpoint: CollectionCheckpoint; changed: boolean; queue: T[]; reordered?: boolean } {
  const valid = saved?.signature === signature && Number.isInteger(saved.index) && saved.index >= 0 && saved.index <= queue.length;
  if (mode === 'continue' && valid) return { checkpoint: { ...saved!, processedKeys: [...saved!.processedKeys] }, changed: false, queue };
  // A traversal-order update is not a search-criteria change. Keep completed combinations and
  // the partial current combination in place, then traverse the remaining items in the new order.
  // Keeping that prefix allows legacy index-based checkpoints to resume without losing any work.
  if (mode === 'continue' && saved && Number.isInteger(saved.index) && saved.index >= 0 && saved.index <= queue.length) {
    try {
      const [before, beforeCriteria] = JSON.parse(saved.signature);
      const [after, afterCriteria] = JSON.parse(signature);
      const keys = (items: unknown[]) => items.map(item => JSON.stringify(item));
      if (Array.isArray(before) && Array.isArray(after) && before.length === after.length &&
          JSON.stringify(beforeCriteria) === JSON.stringify(afterCriteria)) {
        const oldKeys = keys(before), newKeys = keys(after);
        const itemMap = new Map(newKeys.map((key, index) => [key, queue[index]]));
        if (itemMap.size === queue.length && new Set(oldKeys).size === oldKeys.length && oldKeys.every(key => itemMap.has(key))) {
          const prefix = oldKeys.slice(0, Math.min(saved.index + 1, queue.length));
          const retained = new Set(prefix);
          const aligned = [...prefix, ...newKeys.filter(key => !retained.has(key))];
          const restoredQueue = aligned.map(key => itemMap.get(key)!);
          const restoredSignature = JSON.stringify([aligned.map(key => JSON.parse(key)), afterCriteria]);
          return { checkpoint: { ...saved, signature: restoredSignature, processedKeys: [...saved.processedKeys] },
            changed: false, queue: restoredQueue, reordered: restoredSignature !== saved.signature };
        }
      }
    } catch { /* Invalid or genuinely changed checkpoints use the normal restart requirement. */ }
  }
  const first = queue[0];
  return { checkpoint: { signature, index: 0, keyword: first?.keyword || '', location: first?.location || '',
    processedKeys: [], lastTitle: '', updatedAt: Date.now(), complete: !queue.length }, changed: Boolean(saved && !valid), queue };
}
export function acknowledgeCollectionJob(checkpoint: CollectionCheckpoint, key: string, title: string): CollectionCheckpoint {
  if (!key || checkpoint.processedKeys.includes(key)) return checkpoint;
  return { ...checkpoint, processedKeys: [...checkpoint.processedKeys, key], lastTitle: title, updatedAt: Date.now() };
}
export function advanceCollection(checkpoint: CollectionCheckpoint, queue: CollectionCombination[]): CollectionCheckpoint {
  const index = checkpoint.index + 1, next = queue[index];
  return { ...checkpoint, index, keyword: next?.keyword || checkpoint.keyword, location: next?.location || checkpoint.location,
    processedKeys: [], lastTitle: '', complete: index >= queue.length, updatedAt: Date.now() };
}
export function collectionJobKey(job: JobMeta): string {
  if (job.jobId) return `id:${job.jobId}`;
  try { const u = new URL(job.url || ''); return `url:${u.origin}${u.pathname}`; } catch {}
  return `text:${[job.title, job.company, job.location, job.salary].join('|')}`;
}
