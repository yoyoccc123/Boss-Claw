import type { PendingItem } from './types';

/** Old builds called a missing receipt a retryable failure. Preserve uncertainty, never invent success. */
export function repairUnconfirmedDeliveries(items: PendingItem[]): PendingItem[] {
  return items.map(item => (item.status === 'failed' || item.status === 'approved_queue') && !item.riskBlocked && !item.deliveryNeedsReview
    && (item.greetingSendAttempted === true || /未能确认文字气泡已发送|目标会话已有相同招呼语，但发送回执未确认/.test(item.error || ''))
    ? { ...item, status: 'failed', deliveryNeedsReview: true, retryable: false, greetingStatus: 'needs_review', greetingSendAttempted: true }
    : item);
}
