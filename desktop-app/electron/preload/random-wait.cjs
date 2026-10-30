'use strict';

// Shared by the settings renderer and the guest preload. These waits only slow
// operations down; they never grant quota or replace platform restrictions.
const DEFAULT_RANDOM_WAITS = Object.freeze({
  collectionJob: Object.freeze({ minSeconds: 3, maxSeconds: 7 }),
  collectionStep: Object.freeze({ minSeconds: 0.8, maxSeconds: 2 }),
  deliveryStep: Object.freeze({ minSeconds: 1, maxSeconds: 3 }),
});
const PLATFORM_IDS = ['boss', 'liepin', 'zhaopin', 'job51', 'wuba'];
function normalizeRanges(input, defaults = DEFAULT_RANDOM_WAITS) {
  const result = {};
  for (const key of Object.keys(DEFAULT_RANDOM_WAITS)) {
    const fallback = defaults[key];
    const limit = key === 'collectionJob' ? 300 : 15;
    const value = input?.[key];
    const number = (n, defaultValue) => typeof n === 'number' && Number.isFinite(n)
      ? Math.round(Math.min(limit, Math.max(0, n)) * 10) / 10 : defaultValue;
    const minSeconds = number(value?.minSeconds, fallback.minSeconds);
    result[key] = { minSeconds, maxSeconds: Math.max(minSeconds, number(value?.maxSeconds, fallback.maxSeconds)) };
  }
  return result;
}
// Missing overrides inherit the user's existing global ranges on upgrade.
// Keep configured ranges when disabled so switching back on restores them.
function platformRandomWaits(input, platform) {
  const value = input?.platforms?.[platform];
  return {
    ...normalizeRanges(value, normalizeRanges(input)),
    collectionEnabled: value?.collectionEnabled !== false,
    deliveryEnabled: value?.deliveryEnabled !== false,
  };
}
function normalizeRandomWaits(input, platform) {
  if (PLATFORM_IDS.includes(platform)) {
    const policy = platformRandomWaits(input, platform);
    const zero = () => ({ minSeconds: 0, maxSeconds: 0 });
    return {
      collectionJob: policy.collectionEnabled ? policy.collectionJob : zero(),
      collectionStep: policy.collectionEnabled ? policy.collectionStep : zero(),
      deliveryStep: policy.deliveryEnabled ? policy.deliveryStep : zero(),
    };
  }
  const result = normalizeRanges(input);
  if (input?.platforms && typeof input.platforms === 'object') {
    result.platforms = {};
    for (const id of PLATFORM_IDS) {
      if (input.platforms[id] && typeof input.platforms[id] === 'object')
        result.platforms[id] = platformRandomWaits(input, id);
    }
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
module.exports = { DEFAULT_RANDOM_WAITS, normalizeRandomWaits, platformRandomWaits, sampleWaitMs, waitInterruptibly };
