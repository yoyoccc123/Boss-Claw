import type { AppConfig, PendingItem } from './types';
import { resolveQueueMinScore } from './matching';
import { normalizeJobDetailMetadata, resolveJobDetailUrl, isZhaopinCardFragment } from './jobDetailLink';
import { platformEnabled } from './platforms';
import { isQualifiedPending } from './collectionGoal';

export function autoConfirmationReason(item: PendingItem, config: AppConfig): string {
  if (item.manualConfirmationRequired) return '已手动撤回，等待再次确认';
  if (!isQualifiedPending(item)) return '岗位分析未通过，需要复核';
  if (item.analysis!.score < resolveQueueMinScore(config)) return '低于当前最低入队分';
  if (!platformEnabled(config, item.job.platform || 'boss')) return '来源平台未启用';
  if (item.deliveryNeedsReview || item.error || item.greetingSendAttempted || item.resumeDeliveredAt || item.sentAt || item.retryCount) return '已有投递记录或异常，需要人工复核';
  if (item.linkIncomplete || !resolveJobDetailUrl(item.job) || isZhaopinCardFragment(item.job)) return '岗位详情链接不完整，需要重新采集';
  if (String(item.deliveryGreeting || item.analysis?.greeting || '').trim().length < 8) return '招呼语为空或过短，需要补充';
  return '';
}
// Confirming queues work; starting/stopping the delivery engine remains a separate user action.
export function autoConfirmPending(pending: PendingItem[], config: AppConfig, now = Date.now()): PendingItem[] {
  if (config.executionMode !== 'auto') return pending;
  let changed = false;
  const next = pending.map(p => {
    if (p.status !== 'pending' || autoConfirmationReason(p, config)) return p;
    changed = true;
    return { ...p, job: normalizeJobDetailMetadata(p.job), deliveryGreeting: String(p.deliveryGreeting || p.analysis?.greeting || '').trim(),
      status: 'approved_queue' as const, approvedAt: p.approvedAt || now };
  });
  return changed ? next : pending;
}
