import type { PendingItem } from './types';

// v2.5.31's exact identity rejection happened before any editor input/send operation.
const LEGACY_IDENTITY_REJECTION = '简历已投递；智联聊天中的公司或岗位与目标不一致，工作台招呼语未发送';
export function canSupplementZhaopinGreeting(item: PendingItem): boolean {
  if (item.job?.platform !== 'zhaopin' || item.status !== 'sent' || item.greetingStatus === 'sent' || item.greetingStatus === 'skipped' || item.greetingSendAttempted === true) return false;
  if (item.greetingStatus !== 'needs_review') return true;
  return item.greetingSendAttempted === false || item.error === LEGACY_IDENTITY_REJECTION;
}
