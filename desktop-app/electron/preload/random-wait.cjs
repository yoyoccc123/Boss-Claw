'use strict';

// Shared by the settings renderer and the guest preload. These waits only slow
// operations down; they never grant quota or replace platform restrictions.
const DEFAULT_RANDOM_WAITS = Object.freeze({
  collectionJob: Object.freeze({ minSeconds: 3, maxSeconds: 7 }),
  collectionStep: Object.freeze({ minSeconds: 0.8, maxSeconds: 2 }),
  deliveryStep: Object.freeze({ minSeconds: 1, maxSeconds: 3 }),
});
function normalizeRandomWaits(input) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_RANDOM_WAITS)) {
    const limit = key === 'collectionJob' ? 300 : 15;
    const value = input?.[key];
    const number = (n, defaultValue) => typeof n === 'number' && Number.isFinite(n)
      ? Math.round(Math.min(limit, Math.max(0, n)) * 10) / 10 : defaultValue;
    const minSeconds = number(value?.minSeconds, fallback.minSeconds);
    result[key] = { minSeconds, maxSeconds: Math.max(minSeconds, number(value?.maxSeconds, fallback.maxSeconds)) };
  }
  return result;
}
function sampleWaitMs(range, random = Math.random) {
  const unit = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.round((range.minSeconds + (range.maxSeconds - range.minSeconds) * unit) * 1000);
}
async function waitInterruptibly(ms, options = {}) {
  const { stopped = () => false, paused = () => false,
    sleep = duration => new Promise(resolve => setTimeout(resolve, duration)), now = Date.now } = options;
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    if (stopped()) return false;
    if (paused()) { await sleep(100); continue; }
    const slice = Math.min(100, remaining), before = now();
    await sleep(slice);
    // Paused time does not consume the remaining random wait.
    if (!paused()) remaining -= Math.max(1, now() - before);
  }
  return !stopped();
}
module.exports = { DEFAULT_RANDOM_WAITS, normalizeRandomWaits, sampleWaitMs, waitInterruptibly };
