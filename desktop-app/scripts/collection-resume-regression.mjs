// Exercise production checkpoints, withdrawal and preload loops without contacting recruitment sites.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compiled = await build({ stdin: { contents: [
  "export * from './src/lib/bossclaw/collectionResume';",
  "export * from './src/lib/bossclaw/autoConfirmation';",
  "export { DEFAULT_CONFIG } from './src/lib/bossclaw/defaults';",
  "export { useDataStore, jobUrlKey, sameJobSoft } from './src/store/useDataStore';",
].join('\n'), resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const memory = new Map(), env = { module: { exports: {} }, console, Date, process: { env: { NODE_ENV: 'production' } },
  localStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) },
  setTimeout: () => 1, clearTimeout: () => {}, fetch: () => { throw Error('No network allowed'); } };
vm.createContext(env); vm.runInContext(compiled.outputFiles[0].text, env);
const T = env.module.exports, config = structuredClone(T.DEFAULT_CONFIG); config.executionMode = 'auto';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const queue = [{ keyword: 'Python', location: '广州', url: 'https://www.zhipin.com/web/geek/jobs?city=1&query=Python' },
  { keyword: 'AI应用', location: '深圳', url: 'https://www.zhipin.com/web/geek/jobs?city=2&query=AI' }];
const signature = T.collectionSignature(queue, config);
let cp = T.beginCollection(queue, signature).checkpoint;
cp = T.acknowledgeCollectionJob(cp, 'a', '岗位 A');
cp = T.acknowledgeCollectionJob(cp, 'b', '岗位 B');
check(T.beginCollection(queue, signature, cp).checkpoint.processedKeys.join() === 'a,b', 'stop/restart retains acknowledged jobs in the current city');
check(T.beginCollection(queue, signature, cp).checkpoint.index === 0, 'partial combination is not advanced');
cp = T.advanceCollection(cp, queue);
check(cp.index === 1 && cp.location === '深圳' && cp.keyword === 'AI应用' && !cp.processedKeys.length, 'completed combination advances city/keyword and resets only its job keys');
const stored = T.useDataStore;
stored.getState().setCollectionCheckpoint('boss', cp);
stored.getState().setCollectionCheckpoint('liepin', T.beginCollection(queue, signature).checkpoint);
const restored = stored.persist.getOptions().merge({ collectionCheckpoints: structuredClone(stored.getState().collectionCheckpoints) }, stored.getState());
check(restored.collectionCheckpoints.boss.index === 1 && restored.collectionCheckpoints.liepin.index === 0, 'platform progress survives hydration independently');
stored.getState().setCollectionCheckpoint('boss', T.beginCollection(queue, signature, cp, 'restart').checkpoint);
check(stored.getState().collectionCheckpoints.boss.index === 0 && stored.getState().collectionCheckpoints.liepin.index === 0, 'restart resets only the selected platform');
check(T.beginCollection(queue, signature, T.advanceCollection(cp, queue)).checkpoint.complete, 'completed queue is retained rather than starting again');
config.platforms.boss.pendingTarget = 999; config.collectSpeedMs = 400;
check(T.collectionSignature(queue, config) === signature, 'changing quota/speed does not destroy the checkpoint');
config.excludedCompanies = ['示例公司'];
check(T.collectionSignature(queue, config) !== signature, 'filter changes invalidate prior skip decisions');
check(T.beginCollection(queue, T.collectionSignature(queue, config), cp).changed, 'changed search settings are reported');
config.excludedCompanies = [];
const item = { id: 'withdraw', status: 'approved_queue', createdAt: Date.now(), approvedAt: 123,
  job: { platform: 'boss', jobId: 'job1', title: 'Python实习生', url: 'https://www.zhipin.com/job_detail/job1.html' },
  analysis: { score: 75, decision: 'recommend', hardBlocks: [], greeting: '有 Python 自动化实践，希望进一步沟通。' },
  deliveryGreeting: '有 Python 自动化实践，希望进一步沟通。' };
stored.setState({ pending: [item] });
const source = ts.createSourceFile('Workbench.tsx', readFileSync(join(root, 'src/pages/Workbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const vars = new Map();
const visit = n => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) vars.set(n.name.text, n.initializer.getText(source)); ts.forEachChild(n, visit); }; visit(source);
const host = { ...T, Date, Set, config, useCallback: fn => fn, useDataStore: stored,
  useSettingsStore: { getState: () => ({ config }) }, useAppStore: { getState: () => ({ autoAssist: false }) },
  rerankPending: items => items, setPending: items => stored.getState().setPending(items),
  activeId: null, deliverySubmittedRef: { current: false }, deliveryEpochRef: { current: 0 }, domWaitRef: { current: null },
  checkpointContextRef: { current: null }, collectBatchGenerationRef: { current: 1 }, visualActiveRef: { current: true },
  visualTabRef: { current: 'collect' }, collectPhaseRef: { current: 'collecting' }, searchTriggered: { current: false },
  controlCollect: () => { host.visualActiveRef.current = false; }, message: { warning: () => {} }, addLog: () => {},
  recomputeStats: () => {}, platformLabel: p => p, keywordLabel: k => k, setActiveId: () => {}, setApplyStage: () => {},
  updatePending: (id, patch) => stored.getState().updatePending(id, patch), resolveJobDetailUrl: job => job.url,
  normalizeJobDetailMetadata: job => job, isZhaopinCardFragment: () => false,
  upsertTaskRun: r => stored.getState().upsertTaskRun(r), updateTaskRun: (id, patch) => stored.getState().updateTaskRun(id, patch) };
vm.createContext(host);
for (const name of ['onRevert', 'onApprove', 'prepareCollectionCheckpoint', 'checkpointJobAcknowledgment', 'advanceCollectionCheckpoint', 'handleCollectInterrupted', 'markCollectRun', 'settleCollectRuns']) {
  vm.runInContext((await transform(`globalThis.${name}=${vars.get(name)};`, { loader: 'tsx' })).code, host);
}
host.onRevert('withdraw');
check(stored.getState().pending[0].status === 'pending', 'real withdraw handler returns a stopped-engine queued card to pending');
const withdrawn = T.autoConfirmPending(stored.getState().pending, config);
check(withdrawn[0].status === 'pending' && withdrawn[0].manualConfirmationRequired, 'auto confirmation respects manual withdrawal');
check(withdrawn[0].deliveryGreeting === item.deliveryGreeting && withdrawn[0].approvedAt === 123, 'withdrawal preserves text and history');
host.onApprove('withdraw');
check(stored.getState().pending[0].status === 'approved_queue' && !stored.getState().pending[0].manualConfirmationRequired, 'explicit confirmation clears withdrawal hold');
host.prepareCollectionCheckpoint('boss', queue, 'restart');
const ackA = host.checkpointJobAcknowledgment('jobA', '岗位 A');
check(stored.getState().collectionCheckpoints.boss.processedKeys.length === 0, 'raw extraction does not count as processed');
ackA();
check(stored.getState().collectionCheckpoints.boss.processedKeys.join() === 'jobA', 'resolved analysis acknowledges its job');
const delayed = host.checkpointJobAcknowledgment('jobB', '岗位 B');
host.advanceCollectionCheckpoint();
check(stored.getState().collectionCheckpoints.boss.index === 0, 'unresolved jobs prevent advancing to another search');
host.handleCollectInterrupted({ tabId: 'delivery', reason: 'refresh' });
check(host.visualActiveRef.current, 'another tab navigating does not stop collection');
host.handleCollectInterrupted({ tabId: 'collect', reason: 'refresh' });
delayed();
check(!host.visualActiveRef.current && stored.getState().collectionCheckpoints.boss.processedKeys.join() === 'jobA', 'refresh stops waiting and an old analysis cannot advance the saved checkpoint');
host.visualActiveRef.current = true; host.collectPhaseRef.current = 'loading';
host.handleCollectInterrupted({ tabId: 'collect', reason: 'normal search navigation' });
check(host.visualActiveRef.current, 'intentional search loading is allowed');
host.markCollectRun('cr_boss_same', {}, { status: 'running' });
const oldGeneration = host.collectBatchGenerationRef.current;
host.collectBatchGenerationRef.current++;
host.markCollectRun('cr_boss_same', {}, { status: 'running' });
host.settleCollectRuns(['cr_boss_same'], 'old cleanup', oldGeneration);
check(stored.getState().taskRuns.find(r => r.id === 'cr_boss_same').status === 'running', 'old cleanup cannot stop a restarted task with the same combination ID');
host.settleCollectRuns(['cr_boss_same'], 'current cleanup');
check(stored.getState().taskRuns.find(r => r.id === 'cr_boss_same').status === 'skipped', 'current batch still settles its owned task');

// Repeated search terms commonly return already-filtered jobs. Exercise the real ingest callback,
// including in-flight duplicates and failed analyses, before advancing a real checkpoint.
Object.assign(host, {
  Map, ingestedSeenRef: { current: new Set() }, ingestAcknowledgmentsRef: { current: new Map() },
  checkCollectionGoal: () => false, addPendingItem: () => { throw Error('Rejected fixtures must never enter the delivery queue'); },
  addSkipLogOnce: () => {}, flushLastSkipLog: () => {}, meetsHrActivityFilter: () => true,
  isLocationExcluded: () => false, isCompanyExcluded: () => ({ excluded: false }), isJdKeywordExcluded: () => ({ excluded: false }),
  isExpiryFilterEnabled: () => false, PLATFORM_EXPIRY_DEFAULT: {}, detectInterviewMode: () => 'unknown',
  resolveQueueMinScore: () => 60, enrichWelfareRef: { current: () => {} },
});
stored.setState({ pending: [], profile: { hardConstraints: {} } });
vm.runInContext((await transform(`globalThis.ingestJob=${vars.get('ingestJob')};`, { loader: 'tsx' })).code, host);
let analyses = 0;
const rejectJob = async () => { analyses++; return { score: 25, decision: 'reject', scoreSource: 'local' }; };
host.analyzeJobWithResume = rejectJob;
const generation = host.collectBatchGenerationRef.current;
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) {
  const job = { platform, jobId: 'repeat-' + platform, title: '合成低匹配岗位', url: `https://example.test/${platform}/repeat` };
  host.prepareCollectionCheckpoint(platform, queue, 'restart');
  await host.ingestJob(job, generation, host.checkpointJobAcknowledgment(platform + '-first-card', job.title));
  host.advanceCollectionCheckpoint();
  check(host.checkpointContextRef.current.checkpoint.index === 1, `${platform}: the first filtered job completes its search combination`);
  const countBefore = analyses;
  await host.ingestJob({ ...job, url: job.url + '?tracking=changed' }, generation, host.checkpointJobAcknowledgment(platform + '-next-card', job.title));
  check(host.checkpointContextRef.current.unresolved.size === 0 && analyses === countBefore, `${platform}: a repeat in the next search is acknowledged without reanalysis`);
  host.advanceCollectionCheckpoint();
  check(host.checkpointContextRef.current.checkpoint.complete, `${platform}: duplicate filtered results cannot stop the next search`);
}
host.prepareCollectionCheckpoint('wuba', queue, 'restart');
let releaseAnalysis;
host.analyzeJobWithResume = () => { analyses++; return new Promise(resolve => { releaseAnalysis = resolve; }); };
const concurrent = { platform: 'wuba', jobId: 'concurrent', title: '合成异步岗位', url: 'https://example.test/wuba/concurrent' };
const firstIngest = host.ingestJob(concurrent, generation, host.checkpointJobAcknowledgment('card-one', concurrent.title));
const concurrentBefore = analyses;
await host.ingestJob(concurrent, generation, host.checkpointJobAcknowledgment('card-two', concurrent.title));
check(host.checkpointContextRef.current.unresolved.size === 2 && analyses === concurrentBefore, 'an in-flight duplicate waits for its original analysis and starts no second analysis');
host.advanceCollectionCheckpoint();
check(host.checkpointContextRef.current.checkpoint.index === 0, 'a still-running original analysis never advances the checkpoint');
releaseAnalysis({ score: 20, decision: 'reject', scoreSource: 'local' }); await firstIngest;
check(host.checkpointContextRef.current.unresolved.size === 0 && host.checkpointContextRef.current.checkpoint.processedKeys.length === 2, 'both card identities are acknowledged only after the original processing succeeds');
host.advanceCollectionCheckpoint();
check(host.checkpointContextRef.current.checkpoint.index === 1, 'the completed shared analysis allows the next search');
host.prepareCollectionCheckpoint('wuba', queue, 'restart');
host.analyzeJobWithResume = async () => { throw Error('Synthetic analysis failure'); };
const failing = { ...concurrent, jobId: 'failed', url: 'https://example.test/wuba/failed' };
await host.ingestJob(failing, generation, host.checkpointJobAcknowledgment('failed-one', failing.title));
await host.ingestJob(failing, generation, host.checkpointJobAcknowledgment('failed-two', failing.title));
host.advanceCollectionCheckpoint();
check(host.checkpointContextRef.current.unresolved.size === 2 && host.checkpointContextRef.current.checkpoint.index === 0, 'failed analysis and its duplicates remain unacknowledged and resumable');
host.prepareCollectionCheckpoint('wuba', queue, 'restart');
host.analyzeJobWithResume = () => new Promise(resolve => { releaseAnalysis = resolve; });
const stale = host.ingestJob({ ...concurrent, jobId: 'stale', url: 'https://example.test/wuba/stale' }, generation, host.checkpointJobAcknowledgment('stale-card', concurrent.title));
host.collectBatchGenerationRef.current++;
releaseAnalysis({ score: 20, decision: 'reject' }); await stale;
check(host.checkpointContextRef.current.checkpoint.processedKeys.length === 0, 'stopping during shared analysis prevents late acknowledgments');
const preload = ts.createSourceFile('webview.cjs', readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const pacing = createRequire(import.meta.url)(join(root, 'electron/preload/random-wait.cjs'));
const functions = new Map();
const visitP = n => { if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(preload)); ts.forEachChild(n, visitP); }; visitP(preload);
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) {
  let reordered = false; const events = [];
  const cards = ['A', 'B'].map(id => ({ id, querySelector: () => ({ href: `https://example.test/job/${id}?tracking=secret#hash` }), getAttribute: () => null }));
  const p = { Date, Math, Set, URL, PLATFORM: platform, ADAPTERS: { supportsInlineDetail: () => platform === 'boss' },
    WUBA: { readPageBlock: () => null, listState: () => ({ endReached: false }) },
    readZhaopinPageBlock: () => null,
    LIEPIN_LIST: { explicitlyEmpty: doc => /暂无职位/.test(doc.body?.innerText || ''), readPageBlock: () => null },
    PLATFORM_LABEL: platform,
    location: { href: 'https://example.test/jobs' }, document: { readyState: 'complete' }, collectCtl: {},
    notify: (channel, data) => events.push({ channel, data }), collectNotify: (channel, data) => { events.push({ channel, data }); if (data.phase === 'done') reordered = true; },
    collectCards: () => reordered ? [...cards].reverse() : cards, cardIdentity: card => ({ title: card.id, company: 'company' }),
    extractJobDetail: card => ({ jobId: card.id, title: card.id, welfare: ['五险一金'] }), extractJobFromCardOnly: card => ({ jobId: card.id, title: card.id }),
    smoothScrollIntoView: async () => {}, highlightElement: () => {}, openCardDetail: async () => {}, enrichJobDetail: async () => {},
    waitWhilePaused: async () => {}, waitForBossBrowse: async () => ({ ok: true }), bossBrowsePermission: async () => ({ ok: true }), sleep: async () => {}, jitterDelay: async () => {}, all: () => [], $: () => null,
    resetJdFillState: () => {}, reportJdFillSummary: () => {}, reportBossRestriction: async () => null, ensureCollectStyle: () => {}, loginWallDetected: () => false,
    LINK_SELECTOR: 'a', textOf: card => card.id };
  vm.createContext(p);
  for (const name of ['collectionRandomWait', 'collectionListExplicitlyEmpty', 'stableFallbackJobId', 'collectCardKey', 'visualCollectListOnly', 'visualCollect']) vm.runInContext(functions.get(name), p);
  await p.visualCollect({ seq: 'reorder', maxJobs: 5, autoScroll: false });
  check(events.filter(e => e.data.phase === 'done').map(e => e.data.job.title).join() === 'A,B', `${platform}: reordering cards cannot skip the second job`);
  check(events.some(e => e.channel === 'collect-done' && e.data.reason === 'completed'), `${platform}: completion carries a definitive reason`);
  events.length = 0; reordered = false;
  await p.visualCollect({ seq: 'resume', maxJobs: 5, autoScroll: false, resumeKeys: ['https://example.test/job/A'] });
  check(events.filter(e => e.data.phase === 'done').map(e => e.data.job.title).join() === 'B', `${platform}: resume skips only acknowledged cards`);
  check(events.filter(e => e.data.phase === 'done').every(e => !e.data.cardKey.includes('secret')), `${platform}: saved keys contain no tracking query`);
  events.length = 0; reordered = false;
  p.scrollJobListLoadMore = async () => ({ grew: false, atBottom: false });
  await p.visualCollect({ seq: 'scroll-limit', maxJobs: 5, autoScroll: true, scrollRounds: 1 });
  check(events.some(e => e.channel === 'collect-done' && e.data.reason === 'limit'), `${platform}: scroll cap reports a bounded group completion`);
  events.length = 0; reordered = false;
  await p.visualCollect({ seq: 'card-limit', maxJobs: 1, autoScroll: false });
  check(events.filter(e => e.data.phase === 'done').length === 1 && events.some(e => e.channel === 'collect-done' && e.data.reason === 'limit' && e.data.processed === 1), `${platform}: the raw-card budget reports a normal group limit after exactly one card`);
  let tick = 0;
  class Clock extends Date { static now() { return tick; } }
  p.Date = Clock; p.sleep = async () => { tick += 2000; }; p.collectCards = () => [];
  p.document.body = { innerText: '搜索页渲染异常' };
  events.length = 0;
  await p.visualCollect({ seq: 'missing-list', maxJobs: 5, autoScroll: false, listTimeoutMs: 5000 });
  check(events.some(e => e.channel === 'collect-done' && e.data.reason === 'failed'), `${platform}: missing list is not marked complete`);
  p.document.body.innerText = '暂无职位'; events.length = 0;
  await p.visualCollect({ seq: 'empty-list', maxJobs: 5, autoScroll: false, listTimeoutMs: 5000 });
  check(events.some(e => e.channel === 'collect-done' && e.data.reason === 'completed'), `${platform}: explicitly empty search can finish`);
  p.Date = Date; p.collectCards = () => cards; p.document.body.innerText = '';
  let release, sleepCalls = 0;
  p.sleep = async () => { if (++sleepCalls === 1) await new Promise(resolve => { release = resolve; }); };
  events.length = 0;
  const oldLoop = p.visualCollect({ seq: 'old-loop', maxJobs: 5, autoScroll: false });
  await new Promise(resolve => setImmediate(resolve));
  check(typeof release === 'function', `${platform}: old collector is paused in a real asynchronous step`);
  await p.visualCollect({ seq: 'new-loop', maxJobs: 5, autoScroll: false });
  release(); await oldLoop;
  check(!events.some(e => e.data.seq === 'old-loop' && e.data.phase === 'done'), `${platform}: restarting cannot revive a stopped old preload loop`);
  check(events.some(e => e.data.seq === 'old-loop' && e.data.reason === 'stopped'), `${platform}: old loop reports interruption rather than completion`);
  for (const stopAt of [0, 1, 2]) {
    events.length = 0; reordered = false;
    let waits = 0, opened = 0;
    p.openCardDetail = p.enrichJobDetail = async () => { opened++; };
    p.sleep = async () => {};
    p.randomWait = { ...pacing, sampleWaitMs: range => range.minSeconds * 1000,
      waitInterruptibly: async (_ms, { stopped }) => { if (++waits === stopAt) p.collectCtl.stopped = true; return !stopped(); } };
    await p.visualCollect({ seq: 'paced-' + stopAt, maxJobs: 2, autoScroll: false, randomWaits: pacing.DEFAULT_RANDOM_WAITS });
    if (!stopAt) {
      check(events.filter(e => e.data.phase === 'done').length === 2 && opened === 2, `${platform}: actual collector still processes both jobs with random pauses`);
      check(events.filter(e => e.data.phase === 'random-wait').length >= 4, `${platform}: both between-job and within-job waits report their sampled duration`);
    } else {
      check(opened === 0 && !events.some(e => e.data.phase === 'done'), `${platform}: Stop during random ${stopAt === 1 ? 'job' : 'step'} wait prevents detail access and checkpoint acknowledgement`);
      check(events.some(e => e.data.reason === 'stopped'), `${platform}: interrupted random wait retains an incomplete checkpoint`);
    }
  }
}
console.log(`PASS collection resume and withdrawal: ${checks} production policy/store/host/preload checks; no platform calls.`);
await import('./collection-traversal-regression.mjs');
await import('./zhaopin-list-regression.mjs');
await import('./liepin-list-regression.mjs');
