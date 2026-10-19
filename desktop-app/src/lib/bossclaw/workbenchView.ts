import type { PendingItem } from './types';

export const WORKBENCH_STATUS_LABELS: Record<string, string> = {
  all: '全部未投递', pending: '待确认', approved: '待投递', active: '当前任务',
  sent: '已投递', needs_review: '待核对', failed: '失败',
};

/** The waiting group includes both legacy approved jobs and the current queue state. */
export function matchesWorkbenchStatus(item: PendingItem, filter: string, activeId: string | null = null): boolean {
  if (filter === 'all') return item.status !== 'sent';
  if (filter === 'approved') return (item.status === 'approved' || item.status === 'approved_queue') && item.id !== activeId;
  if (filter === 'active') return item.id === activeId;
  if (filter === 'needs_review') return item.status === 'failed' && item.deliveryNeedsReview === true;
  if (filter === 'failed') return item.status === 'failed' && !item.deliveryNeedsReview;
  return item.status === filter;
}

export function visibleWorkbenchJobs(items: PendingItem[], filter: string, showIgnored = false, activeId: string | null = null): PendingItem[] {
  return items.filter(item => matchesWorkbenchStatus(item, filter, activeId)
    && (showIgnored || (item.status !== 'ignored' && item.status !== 'skipped')));
}
