// Production scope/store/runner checks. Every delivery and collection boundary is a stub.
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = await build({ stdin: { contents: `export * from './src/lib/bossclaw/platformSelection';
export * from './src/lib/bossclaw/priority';export * from './src/lib/bossclaw/autoConfirmation';
export * from './src/lib/bossclaw/platforms';export * from './src/lib/bossclaw/jobDetailLink';
export {DEFAULT_CONFIG} from './src/lib/bossclaw/defaults';export {useAppStore} from './src/store/useAppStore';`, resolveDir: root },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
const memory = new Map(), context = { module: { exports: {} }, URL, console, setTimeout, clearTimeout, process: { env: { NODE_ENV: 'production' } },
  localStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) } };
vm.createContext(context); vm.runInContext(bundle.outputFiles[0].text, context);
const T = context.module.exports, cfg = structuredClone(T.DEFAULT_CONFIG);
for (const p of T.PLATFORM_IDS) cfg.platforms[p].enabled = true;
let checks = 0; const check = (v, label) => { assert.ok(v, label); checks++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(T.selectedDeliveryPlatforms(cfg, null), T.sortedEnabledPlatforms(cfg)), 'legacy unset scope retains enabled platforms');
check(same(T.selectedDeliveryPlatforms(cfg, ['zhaopin']), ['zhaopin']), 'single platform selection');
check(same(T.selectedDeliveryPlatforms(cfg, ['zhaopin', 'boss', 'boss', 'unknown']), ['boss', 'zhaopin']), 'known enabled platforms deduplicated in priority order');
check(T.selectedDeliveryPlatforms(cfg, []).length === 0, 'clearing the selection never delivers all platforms');
check(T.selectedDeliveryPlatforms(cfg, 'unknown').length === 0, 'invalid selection fails closed');
const disabled = structuredClone(cfg); disabled.platforms.zhaopin.enabled = false; disabled.platforms.boss.enabled = false;
check(T.selectedDeliveryPlatforms(disabled, ['zhaopin']).length === 0, 'disabled selected platform cannot silently widen delivery');
check(same(T.rememberedCollectionPlatforms(cfg, ['wuba', 'liepin']), ['wuba', 'liepin']), 'collection remembers its own multi-selection order');
check(same(T.rememberedCollectionPlatforms(disabled, ['boss']), ['liepin']), 'invalid collection choice falls back to the first enabled platform');
check(T.rememberedNewTabPlatform(cfg, 'wuba') === 'wuba', 'new-tab restores non-BOSS preference');
check(T.rememberedNewTabPlatform(disabled, 'boss') === 'liepin', 'disabled new-tab choice falls back without selecting disabled BOSS');
check(T.rememberedNewTabPlatform(cfg, '__newtab__') === '__newtab__', 'blank-tab preference is retained');
const app = T.useAppStore;
app.getState().setBrowserNewTabPlatform('wuba'); app.getState().setCollectionPlatforms(['liepin']); app.getState().setAutoAssist(true);
app.getState().setDeliveryPlatforms(['zhaopin']);
check(!app.getState().autoAssist && app.getState().engineStatus === 'stopped', 'changing scope stops the current engine atomically');
check(app.getState().browserNewTabPlatform === 'wuba' && same(app.getState().collectionPlatforms, ['liepin']), 'delivery selection cannot overwrite browser/collection preferences');
const make = (platform, status = 'approved_queue') => ({ id: platform, status, createdAt: 1000, approvedAt: 1000,
  deliveryGreeting: '这是一段合成测试的求职招呼语', job: { platform, title: '合成岗位', company: '合成公司',
    url: platform === 'zhaopin' ? 'https://www.zhaopin.com/jobdetail/CCL0000000000J00000000000.htm' : 'https://www.liepin.com/job/0000000000.shtml' } });
const legacy = [make('boss', 'approved'), make('liepin', 'approved'), make('zhaopin', 'approved')];
const promoted = T.promoteApprovedToQueue(legacy, cfg, ['zhaopin']);
check(promoted.count === 1 && promoted.next.find(p => p.id === 'boss').status === 'approved'
  && promoted.next.find(p => p.id === 'zhaopin').status === 'approved_queue', 'one-click promotion retains unselected legacy records');
const ast = ts.createSourceFile('Workbench.tsx', readFileSync(join(root, 'src/pages/Workbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const variables = new Map(); const visit = n => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) variables.set(n.name.text, n.initializer.getText(ast)); ts.forEachChild(n, visit); }; visit(ast);
async function runner(scope, executionMode = 'review') {
  const state = { autoAssist: true, deliveryPlatforms: scope }, config = { ...cfg, executionMode }, sent = [], collected = [];
  const data = { pending: [make('boss'), make('liepin'), make('zhaopin')], setPending(v) { this.pending = v; }, recomputeStats() {} };
  const c = { ...T, Date, useAppStore: { getState: () => state }, useDataStore: { getState: () => data }, useSettingsStore: { getState: () => ({ config }) },
    visualActiveRef: { current: false }, cfxActiveRef: { current: false }, collectBatchRef: { current: null }, searchPlatforms: ['boss'], searchTriggered: { current: false },
    isDeliveryClaimed: () => false, setRunning: () => {}, setAutoAssist: v => { state.autoAssist = v; }, addLog: () => {}, setActiveId: () => {},
    setApplyStage: () => {}, deliverySubmittedRef: { current: false }, lastApplyStageRef: { current: '' }, precheckDelivery: () => true,
    checkCollectionGoal: () => false, startCollect: (mode, platforms, automatic) => collected.push({ mode, platforms, automatic }),
    deliverNonBoss: async p => sent.push(p.job.platform), deliverBossDom: async p => sent.push(p.job.platform),
    deliverCamoufox: async p => sent.push(p.job.platform), pauseAssist: msg => { throw Error(msg); } };
  vm.createContext(c); vm.runInContext((await transform(`globalThis.runNext=${variables.get('runNext')};`, { loader: 'tsx' })).code, c);
  return { c, state, data, sent, collected };
}
{
  const h = await runner(['zhaopin']), untouched = JSON.stringify(h.data.pending.slice(0, 2)); await h.c.runNext();
  check(same(h.sent, ['zhaopin']), 'real central runner skips higher-priority unselected platforms');
  h.data.pending.find(p => p.id === 'zhaopin').status = 'sent'; await h.c.runNext();
  check(h.sent.length === 1 && !h.state.autoAssist, 'selected queue completion stops instead of delivering another platform');
  check(JSON.stringify(h.data.pending.slice(0, 2)) === untouched, 'other-platform queued records remain unchanged');
}
{
  const h = await runner(['liepin', 'zhaopin']); await h.c.runNext(); h.data.pending.find(p => p.id === 'liepin').status = 'sent'; await h.c.runNext();
  check(same(h.sent, ['liepin', 'zhaopin']), 'multiple selected platforms retain the configured delivery order');
}
{
  const h = await runner(['zhaopin'], 'auto'); h.data.pending = [make('boss')]; await h.c.runNext();
  check(!h.sent.length && !h.collected.length && !h.state.autoAssist, 'an empty selected queue stops full-auto delivery without collecting more jobs or widening platform scope');
}
{
  const h = await runner(['zhaopin'], 'auto'); h.data.pending = [make('boss')];
  h.c.collectBatchRef.current = { generation: 1, automatic: true }; await h.c.runNext();
  check(!h.state.autoAssist && !h.sent.length && !h.collected.length && h.c.collectBatchRef.current,
    'an empty delivery queue stops independently while an explicitly started collection retains its ownership');
}
{
  const h = await runner([]); await h.c.runNext(); check(!h.sent.length && !h.collected.length && !h.state.autoAssist, 'empty scope cannot collect or dispatch');
}
console.log(`PASS platform selection: ${checks} production preference, store, mixed queue and automatic collection checks; zero platform requests.`);
