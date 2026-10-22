'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readBossPageBlock } = require('./preload/boss-page-block.cjs');
const DEFAULT_POLICY = Object.freeze({ maxViews: 30, windowMinutes: 30 });
const integer = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) >= 1
  ? Math.min(max, Math.floor(Number(value))) : fallback;
function normalizePolicy(value = {}) {
  return { maxViews: integer(value.maxViews, 30, 1000), windowMinutes: integer(value.windowMinutes, 30, 1440) };
}

function createBossBrowseBudget(file, { clock = Date.now, write = null } = {}) {
  let state = { version: 1, policy: { ...DEFAULT_POLICY }, attempts: [], restriction: null, lastNow: 0 };
  let storageError = '';
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.attempts) || saved.attempts.some(t => !Number.isSafeInteger(t) || t < 0)
        || !Number.isSafeInteger(saved.lastNow) || (saved.restriction && (!Number.isFinite(saved.restriction.until) || ![32, 35, 36, 1006].includes(saved.restriction.code)))) throw Error('Invalid browse budget');
      state = { ...saved, policy: normalizePolicy(saved.policy) };
    }
  } catch { storageError = 'BOSS 浏览计数文件无法读取，已停止自动访问，请检查本地数据文件'; }
  function save() {
    if (storageError) return false;
    try {
      if (write) write(state);
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
      }
      return true;
    } catch { storageError = 'BOSS 浏览计数无法保存，已停止自动访问，请检查磁盘空间和权限'; return false; }
  }
  function status(now = clock()) {
    const policy = state.policy, windowMs = policy.windowMinutes * 60_000;
    const times = state.attempts.filter(t => t > now - windowMs);
    const blocked = !!state.restriction && state.restriction.until > now;
    // Once the last admission filled the window, keep the whole batch closed until its
    // newest record expires. Deriving this from durable history also preserves the wait
    // across restart, even after the oldest records have already expired.
    const atLastView = state.attempts.filter(t => t > state.lastNow - windowMs && t <= state.lastNow);
    const capUntil = atLastView.length >= policy.maxViews && state.lastNow + windowMs > now ? state.lastNow + windowMs : 0;
    const draining = capUntil > now;
    const retryAt = Math.max(capUntil, blocked ? state.restriction.until : 0);
    const error = storageError || (now < state.lastNow ? '系统时间早于已保存的浏览记录，已停止自动访问，请校准时间' : '');
    return { ok: !error && !blocked && retryAt <= now, blocked, error, retryAt,
      count: times.length, ...policy, draining, quotaResetAt: draining ? capUntil : 0,
      code: blocked ? state.restriction.code : undefined,
      message: error || (blocked ? state.restriction.message : draining ? `BOSS 浏览频率限制：每 ${policy.windowMinutes} 分钟最多 ${policy.maxViews} 次，当前 ${times.length} 次；本轮已达上限，等待全部名额到期后再继续` : '') };
  }
  function configure(policy) {
    const next = normalizePolicy(policy);
    if (next.maxViews !== state.policy.maxViews || next.windowMinutes !== state.policy.windowMinutes) {
      const previous = state.policy;
      state.policy = next;
      if (!save()) state.policy = previous;
    }
    return status();
  }
  function reserve() {
    // Freeze one admission timestamp so a record expiring during the save cannot
    // make the before/after counts in its receipt refer to different windows.
    const now = clock(), current = status(now);
    if (!current.ok) return current;
    const windowMs = state.policy.windowMinutes * 60_000;
    const expiredSinceLastView = state.lastNow > 0 ? state.attempts.filter(t => t > state.lastNow - windowMs && t <= now - windowMs).length : 0;
    // Keep a full day so lengthening the configured window cannot reset history.
    state.attempts = state.attempts.filter(t => t > now - 86400_000);
    state.attempts.push(now); state.lastNow = now;
    if (!save()) return status();
    const after = status(now), remainingViews = Math.max(0, after.maxViews - after.count);
    const release = expiredSinceLastView ? `；较上次查看，旧记录到期释放 ${expiredSinceLastView} 个名额` : '';
    const next = after.draining
      ? `；本轮已达上限，等待至 ${new Date(after.quotaResetAt).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })} 全部名额到期后再继续` : '';
    return { ...after, ok: true, admittedAt: now, countBefore: current.count, expiredSinceLastView, remainingViews,
      admissionMessage: `BOSS 已允许本次查看：近 ${after.windowMinutes} 分钟 ${current.count} → ${after.count}/${after.maxViews} 次（本次 +1）${release}；剩余 ${remainingViews} 个名额${next}` };
  }
  function observe(url, text) {
    const found = readBossPageBlock(url, text, clock());
    if (!found) return status();
    const old = state.restriction;
    if (old?.until > clock() && !found.explicitUntil
      && (old.explicitUntil || old.code === found.code || old.until >= found.until)) return status();
    state.restriction = found;
    save(); return status();
  }
  return { status, configure, reserve, observe };
}
module.exports = { createBossBrowseBudget, normalizePolicy, DEFAULT_POLICY };
