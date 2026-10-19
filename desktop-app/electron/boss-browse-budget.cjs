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
  function status() {
    const now = clock(), policy = state.policy, windowMs = policy.windowMinutes * 60_000;
    const times = state.attempts.filter(t => t > now - windowMs);
    const blocked = !!state.restriction && state.restriction.until > now;
    const capUntil = times.length >= policy.maxViews ? times[times.length - policy.maxViews] + windowMs : 0;
    const retryAt = Math.max(capUntil, blocked ? state.restriction.until : 0);
    const error = storageError || (now < state.lastNow ? '系统时间早于已保存的浏览记录，已停止自动访问，请校准时间' : '');
    return { ok: !error && !blocked && retryAt <= now, blocked, error, retryAt,
      count: times.length, ...policy, code: blocked ? state.restriction.code : undefined,
      message: error || (blocked ? state.restriction.message : retryAt > now ? `BOSS 浏览频率限制：每 ${policy.windowMinutes} 分钟最多 ${policy.maxViews} 次，当前 ${times.length} 次` : '') };
  }
  function configure(policy) {
    state.policy = normalizePolicy(policy); save(); return status();
  }
  function reserve() {
    const current = status();
    if (!current.ok) return current;
    const now = clock();
    // Keep a full day so lengthening the configured window cannot reset history.
    state.attempts = state.attempts.filter(t => t > now - 86400_000);
    state.attempts.push(now); state.lastNow = now;
    if (!save()) return status();
    return { ...status(), ok: true, admittedAt: now };
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
