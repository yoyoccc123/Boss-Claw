// Execute the real search runners over synthetic cities/directions. No platform requests or messages.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compiled = await build({ stdin: { contents: `export * from './src/lib/bossclaw/randomWait';export * from './src/lib/bossclaw/collectionResume';export * from './src/lib/bossclaw/collectionGoal';export * from './src/lib/bossclaw/searchUrl';export * from './src/lib/bossclaw/platformUrls';export {DEFAULT_CONFIG} from './src/lib/bossclaw/defaults';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const env = { module: { exports: {} }, console, Date, URL, URLSearchParams, localStorage: { getItem: () => null } };
vm.createContext(env); vm.runInContext(compiled.outputFiles[0].text, env); const T = env.module.exports;
let checks = 0;
const check = (v, msg) => { assert.ok(v, msg); checks++; };
const config = { ...structuredClone(T.DEFAULT_CONFIG), targetLocations: ['广州', '深圳'], employmentTypes: ['实习'],
  wubaSearchFilters: { category: 'auto' }, camoufox: { enabled: true, pages: 1, os: 'windows' } };
const plan = { confirmed: true, items: [
  { id: 'python', name: 'Python开发', enabled: true, keywords: ['Python'], priority: 2, score: 80 },
  { id: 'vibe', name: 'Vibe Coding', enabled: true, keywords: ['Vibe Coding', 'Agent'], priority: 1, score: 85 },
] };
const makeQueue = (platform, cfg = config, p = plan) => platform === 'boss' ? T.buildSearchQueue(p, cfg) : T.buildPlatformSearchQueue(platform, p, cfg);
const pairs = q => q.map(x => `${x.location}/${x.directionName}/${x.keyword}`).join('|');
const expected = ['广州/Vibe Coding/Vibe Coding', '广州/Vibe Coding/Agent', '广州/Python开发/Python',
  '深圳/Vibe Coding/Vibe Coding', '深圳/Vibe Coding/Agent', '深圳/Python开发/Python'].join('|');
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) {
  check(pairs(makeQueue(platform)) === expected, platform + ': each city traverses all directions by priority before the next city');
}
const keywordFree = T.buildPlatformSearchQueue('wuba', plan, { ...config, collectWithoutKeyword: true });
check(keywordFree.map(x => `${x.location}/${x.directionName}`).join('|') === '广州/Vibe Coding|广州/Python开发|深圳/Vibe Coding|深圳/Python开发', '58 keyword-free category searches also traverse all directions within each city');
check(keywordFree.every(x => !new URL(x.url).searchParams.has('key')), 'keyword-free traversal never adds search keywords');

const migrationConfig = { ...config, targetLocations: ['广州', '中山', '深圳'] };
const migrationPlan = { confirmed: true, items: [...plan.items.map(x => ({ ...x, keywords: [x.keywords[0]] })),
  { id: 'vision', name: '计算机视觉', enabled: true, keywords: ['YOLO'], priority: 3, score: 70 }] };
const canonical = makeQueue('wuba', migrationConfig, migrationPlan);
const oldQueue = [...canonical].sort((a, b) => a.directionPriority - b.directionPriority || migrationConfig.targetLocations.indexOf(a.location) - migrationConfig.targetLocations.indexOf(b.location));
const oldSignature = T.collectionSignature(oldQueue, migrationConfig), newSignature = T.collectionSignature(canonical, migrationConfig);
let saved = T.advanceCollection(T.beginCollection(oldQueue, oldSignature).checkpoint, oldQueue);
saved = T.acknowledgeCollectionJob(saved, 'already-analyzed-card', '合成已处理岗位');
const original = JSON.stringify({ canonical, saved });
let restored = T.beginCollection(canonical, newSignature, saved);
check(!restored.changed && restored.reordered, 'an order-only upgrade is migrated instead of requiring a fresh collection');
check(restored.checkpoint.index === 1 && restored.queue[1].url === oldQueue[1].url && restored.checkpoint.processedKeys.join() === 'already-analyzed-card', 'the partial current city/direction retains its card acknowledgments');
check(restored.queue[0].url === oldQueue[0].url && restored.queue.slice(2).map(x => x.url).join() === canonical.filter(x => x.url !== oldQueue[0].url && x.url !== oldQueue[1].url).map(x => x.url).join(), 'completed prefix stays skipped and remaining combinations follow the new city-first order');
check(JSON.stringify({ canonical, saved }) === original, 'order migration never mutates the supplied queue or checkpoint');
check(restored.checkpoint.signature === T.collectionSignature(restored.queue, migrationConfig), 'the migrated signature describes the exact runnable queue');
const resumedAgain = T.beginCollection(canonical, newSignature, restored.checkpoint);
check(pairs(resumedAgain.queue) === pairs(restored.queue) && !resumedAgain.reordered, 'reopening again retains the same migrated traversal without repeated migration');
const nextCheckpoint = T.advanceCollection(restored.checkpoint, restored.queue);
check(nextCheckpoint.location === '广州' && nextCheckpoint.keyword === 'Python', 'after the partial group, resume fills the remaining directions in the first city');
check(T.beginCollection(canonical, newSignature, saved, 'restart').checkpoint.index === 0, 'explicit restart uses the canonical city-first queue');
check(!T.beginCollection(canonical, T.collectionSignature(canonical, { ...migrationConfig,
  randomWaits: { ...migrationConfig.randomWaits, platforms: { liepin: { collectionEnabled: false } } },
}), saved).changed, 'per-platform pacing changes never invalidate saved collection progress');
const altered = { ...migrationConfig, excludedCompanies: ['改变筛选条件'] };
check(T.beginCollection(canonical, T.collectionSignature(canonical, altered), saved).changed, 'real criteria changes still require restarting');
check(T.beginCollection(canonical.slice(1), T.collectionSignature(canonical.slice(1), migrationConfig), saved).changed, 'removed combinations cannot masquerade as an order-only update');
let completed = T.beginCollection(oldQueue, oldSignature).checkpoint;
while (!completed.complete) completed = T.advanceCollection(completed, oldQueue);
check(T.beginCollection(canonical, newSignature, completed).checkpoint.complete, 'completed old queues do not start searching again after an order upgrade');

const source = ts.createSourceFile('Workbench.tsx', readFileSync(join(root, 'src/pages/Workbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), vars = new Map();
const visit = n => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) vars.set(n.name.text, n.initializer.getText(source)); ts.forEachChild(n, visit); }; visit(source);
async function harness(platform, engine, options = {}) {
  const cfg = options.config || structuredClone(config), directionPlan = options.plan || structuredClone(plan);
  const data = { collectionCheckpoints: { ...(options.saved ? { [platform]: structuredClone(options.saved) } : {}) }, pending: [], collectionCounts: {}, profile: {},
    setCollectionCheckpoint: (p, cp) => { data.collectionCheckpoints[p] = cp; } };
  const urls = [], searches = [], logs = [], warnings = [], runs = [], commands = [], collectOptions = [], activations = []; let analyses = 0, probes = 0;
  const repeatedJob = { platform, jobId: 'same-filtered-job', title: '合成重复岗位', url: 'https://example.test/same-filtered-job' };
  const h = { ...T, Promise, Date, Math, Set, Map, config: cfg, directionPlan, profile: {},
    electronApi: { bossBrowse: { call: async () => ({ ok: true }) } },
    useCallback: fn => fn, useSettingsStore: { getState: () => ({ config: cfg }) }, useDataStore: { getState: () => data },
    useAppStore: { getState: () => ({ autoAssist: false }) }, checkCollectionGoal: () => false,
    collectionGoal: () => ({ remaining: options.remaining ?? 1000, count: 0, target: 50 }), isLockedOut: () => false, ensureBossLogin: async () => true,
    loadBossCityCodes: async () => {}, platformLabel: p => p, keywordLabel: k => k, COLLECT_RUN_PREFIX: 'cr_',
    collectBatchGenerationRef: { current: 1 }, visualActiveRef: { current: false }, cfxActiveRef: { current: false },
    ingestedSeenRef: { current: new Set() }, ingestAcknowledgmentsRef: { current: new Map() },
    checkpointContextRef: { current: null }, collectListReadyLoggedRef: { current: false }, visualLoginBlockedRef: { current: '' },
    visualTabRef: { current: '' }, collectPhaseRef: { current: '' }, collectingPlatformRef: { current: null }, collectTerminalRef: { current: '' },
    goalLoggedRef: { current: new Set() }, collectDoneResolve: { current: null },
    analysisQueueRef: { current: null }, addLog: (level, msg) => logs.push({ level, msg }), message: { warning: msg => warnings.push(msg) },
    setVisualCollecting: () => {}, setVisualPaused: () => {}, setVisualItem: () => {}, setCfxCollecting: () => {},
    markCollectRun: (id, base, update) => runs.push({ id, ...base, ...update }), settleCollectRuns: () => {},
    sleep: async () => {}, recomputeStats: () => {}, requestRunNext: () => {},
    camoufoxStatus: async () => ({ ready: true, engine: { loggedIn: true } }),
    collectFaultScope: () => 'none', isCamoufoxStopCode: () => false, isCamoufoxEnvCode: () => false,
    normalizeJobDetailMetadata: j => j, isZhaopinCardFragment: () => false, resolveJobDetailUrl: j => j.url,
    jobUrlKey: j => j.url, sameJobSoft: () => false, meetsHrActivityFilter: () => true,
    isLocationExcluded: () => false, isCompanyExcluded: () => ({ excluded: false }), isJdKeywordExcluded: () => ({ excluded: false }),
    isExpiryFilterEnabled: () => false, PLATFORM_EXPIRY_DEFAULT: {}, detectInterviewMode: () => 'unknown',
    addSkipLogOnce: () => {}, flushLastSkipLog: () => {}, resolveQueueMinScore: () => 60,
    analyzeJobWithResume: async () => { analyses++; return { score: 25, decision: 'reject' }; },
    addPendingItem: () => { throw Error('Rejected fixtures must never enter the delivery queue'); }, camoufoxJobToMeta: j => j,
  };
  h.webviewApi = { current: { getFirstTabId: () => 'tab', getActiveTabId: () => 'tab', findTabByPlatform: () => 'tab',
    activateTab: id => activations.push(id),
    hasTab: () => true, loadURLInTab: (_tab, url) => urls.push(url), isPreloadReady: () => true, isLoading: () => false,
    pageStatus: async () => { const status=options.pageStatuses?.[Math.min(probes,options.pageStatuses.length-1)];probes++;
      return status||{ readyState: 'complete', cards: 0, bodyLen: 2000 }; }, sendInTab: (...args) => commands.push(args) } };
  h.visualCollectInTab = async (_tab, opts) => {
    collectOptions.push(opts);
    h.collectTerminalRef.current = options.failFirst && collectOptions.length === 1 ? 'failed' : options.terminal ?? 'completed';
    if (options.duplicates) await h.ingestJob(repeatedJob, h.collectBatchGenerationRef.current,
      h.checkpointJobAcknowledgment('card-' + urls.length, repeatedJob.title));
    if (options.unresolved) h.checkpointContextRef.current.unresolved.add('unconfirmed-analysis');
    if (options.staleGeneration) h.collectBatchGenerationRef.current++;
    if (options.goalDuringAnalysis) h.analysisQueueRef.current = { getStats: () => ({ running: 1, queued: 0 }) };
    if (options.stopAfter && urls.length >= options.stopAfter) h.visualActiveRef.current = false;
  };
  h.camoufoxSearch = async (keyword, cityCode, _pages, _os, p, criteria) => {
    searches.push({ keyword, cityCode, platform: p, criteria });
    if (options.stopAfter && searches.length >= options.stopAfter) h.cfxActiveRef.current = false;
    return { ok: true, jobs: options.duplicates ? [repeatedJob] : [] };
  };
  vm.createContext(h);
  for (const name of ['collectRunId', 'filterQueueByRunIds', 'prepareCollectionCheckpoint', 'checkpointJobAcknowledgment', 'advanceCollectionCheckpoint', 'ingestJob', 'visualWait', 'runVisualCollect', 'runCamoufoxCollect']) {
    vm.runInContext((await transform(`globalThis.${name}=${vars.get(name)};`, { loader: 'tsx' })).code, h);
  }
  if (options.goalDuringAnalysis) {
    h.collectionGoal = T.collectionGoal;
    vm.runInContext((await transform(`globalThis.checkCollectionGoal=${vars.get('checkCollectionGoal')};`, { loader: 'tsx' })).code, h);
    h.sleep = async ms => {
      if (ms === 200) data.collectionCounts[platform] = { date: T.collectionDay(Date.now()), count: T.collectionGoal(cfg, data.pending, data.collectionCounts, platform).target };
    };
  }
  const outcome = await h[engine === 'visual' ? 'runVisualCollect' : 'runCamoufoxCollect'](platform, undefined, options.mode || 'restart');
  return { h, data, urls, searches, logs, warnings, runs, outcome, analyses, commands, collectOptions, activations, probes };
}
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) for (const engine of ['visual', 'camoufox']) {
  const expectedQueue = makeQueue(platform), result = await harness(platform, engine);
  check(result.outcome === 'done' && !result.warnings.length && result.data.collectionCheckpoints[platform].complete, `${platform}/${engine}: real runner completes all cities and directions with empty results`);
  if (engine === 'visual') {
    check(result.urls.join() === expectedQueue.map(x => x.url).join(), `${platform}: real webview navigation uses each successive city/direction URL`);
    check(result.activations.join()==='tab', `${platform}: the real collector activates its chosen platform tab before collecting`);
  }
  else {
    assert.equal(result.searches.map(x => `${x.keyword}/${x.cityCode}`).join('|'), expectedQueue.map(x => `${x.keyword}/${platform === 'boss' ? (T.resolveCityCode(x.location) || '100010000') : x.location}`).join('|'), `${platform}: real engine calls change keyword and city together with the queue`); checks++;
  }
  check([...new Map(result.runs.filter(x => x.status === 'running').map(x => [x.id, x])).values()].map(x => `${x.location}/${x.directionName}/${x.keyword}`).join('|') === expected, `${platform}/${engine}: task progress labels match the actual direction and city traversal`);
  check(result.logs.some(x => x.msg.includes('方向：Python开发')) && result.logs.some(x => x.msg.includes('深圳')), `${platform}/${engine}: logs explicitly show direction and city changes`);
  const stopped = await harness(platform, engine, { stopAfter: 2 });
  check(!stopped.data.collectionCheckpoints[platform].complete && stopped.data.collectionCheckpoints[platform].index === 1, `${platform}/${engine}: stopping inside a combination keeps that exact combination`);
  const resumed = await harness(platform, engine, { saved: stopped.data.collectionCheckpoints[platform], mode: 'continue' });
  check(resumed.data.collectionCheckpoints[platform].complete && (engine === 'visual' ? resumed.urls.length : resumed.searches.length) === expectedQueue.length - 1, `${platform}/${engine}: continue reaches the later directions/city without repeating completed combinations`);
}
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) {
  const cfg = structuredClone(config);
  cfg.randomWaits.platforms = { [platform]: { collectionJob: { minSeconds: 8, maxSeconds: 10 }, collectionEnabled: true } };
  const custom = await harness(platform, 'visual', { config: cfg });
  check(custom.collectOptions.length > 0 && custom.collectOptions.every(o => o.randomWaits.collectionJob.minSeconds === 8
    && o.randomWaits.collectionJob.maxSeconds === 10), platform + ': actual startup payload uses its own custom range');
  cfg.randomWaits.platforms[platform].collectionEnabled = false;
  const off = await harness(platform, 'visual', { config: cfg });
  check(off.collectOptions.length > 0 && off.collectOptions.every(o => o.randomWaits.collectionJob.maxSeconds === 0
    && o.randomWaits.collectionStep.maxSeconds === 0), platform + ': actual startup disables collection waits without disabling collection');
}
for (const engine of ['visual', 'camoufox']) {
  const splitConfig = { ...structuredClone(config), degrees: ['大专', '本科'] };
  const splitQueue = T.buildPlatformSearchQueue('liepin', plan, splitConfig);
  const split = await harness('liepin', engine, { config: splitConfig });
  check(split.data.collectionCheckpoints.liepin.complete && !split.warnings.length, `${engine}: Liepin empty results continue through every degree, keyword and city`);
  check(new Set(split.runs.filter(r => r.status === 'running').map(r => r.id)).size === splitQueue.length, `${engine}: degree-specific task records cannot overwrite one another`);
  check(engine === 'visual' ? split.urls.length === splitQueue.length : split.searches.every(s => s.criteria.degrees.length === 1), `${engine}: each Liepin native search carries one supported education value`);
  const duplicates = await harness('wuba', engine, { duplicates: true });
  check(duplicates.data.collectionCheckpoints.wuba.complete && duplicates.analyses === 1, `${engine}: real repeated-result ingestion still advances across all directions and cities without reanalysis`);
  const result = await harness('wuba', engine, { config: migrationConfig, plan: migrationPlan, saved, mode: 'continue' });
  const expectedQueue = restored.queue.slice(saved.index);
  check(result.data.collectionCheckpoints.wuba.complete && !result.warnings.length, `${engine}: a real runner accepts the upgraded traversal and finishes without a restart`);
  check(engine === 'visual' ? result.urls.join() === expectedQueue.map(x => x.url).join() : result.searches.map(x => `${x.keyword}/${x.cityCode}`).join('|') === expectedQueue.map(x => `${x.keyword}/${x.location}`).join('|'), `${engine}: migrated actual search calls preserve the partial group and use the reordered remainder`);
}
for (const platform of ['boss', 'liepin', 'zhaopin', 'job51', 'wuba']) {
  const limited = await harness(platform, 'visual', { terminal: 'limit', duplicates: true, remaining: 1 });
  check(limited.data.collectionCheckpoints[platform].complete && limited.urls.join() === makeQueue(platform).map(x => x.url).join(), `${platform}: a normal group limit advances through all keywords, directions and cities`);
  check(limited.analyses === 1 && T.collectionGoal(config, limited.data.pending, limited.data.collectionCounts, platform).count === 0, `${platform}: rejected/duplicate cards do not consume the qualified daily goal`);
  check(limited.collectOptions.every(x => x.maxJobs === 1), `${platform}: the scan-budget limit stays bounded independently of advancing the queue`);
  check(limited.logs.some(x => x.msg.includes('本组达到采集上限')) && !limited.logs.some(x => x.msg.includes('本组尚未完成')), `${platform}: a bounded normal completion is logged as moving on rather than an interruption`);
  check(limited.runs.some(x => x.status === 'success' && x.stageLabel.includes('达到本组采集上限')), `${platform}: task progress records capped completion explicitly`);
  for (const terminal of ['stopped', 'blocked', 'failed', '']) {
    const interrupted = await harness(platform, 'visual', { terminal });
    check(interrupted.urls.length === (platform === 'zhaopin' && terminal === 'failed' ? 2 : 1) && interrupted.data.collectionCheckpoints[platform].index === 0 && !interrupted.data.collectionCheckpoints[platform].complete, `${platform}: ${terminal || 'missing completion'} stops without advancing after at most one permitted list retry`);
  }
  const unconfirmed = await harness(platform, 'visual', { terminal: 'limit', unresolved: true });
  check(unconfirmed.urls.length === 1 && unconfirmed.data.collectionCheckpoints[platform].index === 0, `${platform}: a scan cap never acknowledges unresolved analysis`);
  const goal = await harness(platform, 'visual', { terminal: 'limit', goalDuringAnalysis: true });
  check(goal.urls.length === 1 && goal.logs.some(x => x.msg.includes('达到待确认目标')), `${platform}: reaching the qualified daily goal while draining analysis stops before the next group`);
  check(goal.commands.some(x => x[1] === 'collect-control' && x[2]?.action === 'stop'), `${platform}: the real goal guard still sends stop to the collector`);
  const manual = await harness(platform, 'visual', { terminal: 'limit', stopAfter: 1 });
  check(manual.urls.length === 1 && manual.data.collectionCheckpoints[platform].index === 0, `${platform}: manual stop takes precedence over a simultaneous group limit`);
  const stale = await harness(platform, 'visual', { terminal: 'limit', staleGeneration: true });
  check(stale.outcome === 'abort' && stale.urls.length === 1 && stale.data.collectionCheckpoints[platform].index === 0, `${platform}: stale collection generations cannot advance after a group limit`);
}
const recoveredList = await harness('zhaopin', 'visual', { failFirst: true });
check(recoveredList.data.collectionCheckpoints.zhaopin.complete && recoveredList.urls[0] === recoveredList.urls[1]
  && recoveredList.urls.length === makeQueue('zhaopin').length + 1,
  'Zhaopin retries a transient zero-job failure once at the same city/keyword, then continues every later combination');
check(recoveredList.collectOptions.every(o => o.expectedSearchUrl?.includes('zhaopin.com'))
  && recoveredList.logs.filter(x => x.msg.includes('重新加载重试一次')).length === 1,
  'Zhaopin host forwards expected search scope and explains a bounded retry');
const pendingLogin=await harness('liepin','visual',{stopAfter:1,pageStatuses:[
  {readyState:'interactive',cards:0,bodyLen:456,loginWall:false,loginWallPending:true,loginWallSource:'login-form'},
  {readyState:'complete',cards:0,bodyLen:456,loginWall:false,loginWallPending:true,loginWallSource:'login-form'},
  {readyState:'complete',cards:5,bodyLen:1255,loginWall:false,loginWallPending:false},
]});
check(pendingLogin.probes>=3&&pendingLogin.collectOptions.length===1&&!pendingLogin.h.visualLoginBlockedRef.current,
  'Liepin host waits out transient login hydration and admits the later authenticated five-card page');
const actualLogin=await harness('liepin','visual',{pageStatuses:[
  {readyState:'interactive',cards:0,bodyLen:456,loginWall:true,loginWallPending:false,loginWallSource:'auth-url',collectionScopeMatches:false},
]});
check(actualLogin.urls.length===1&&!actualLogin.collectOptions.length&&actualLogin.data.collectionCheckpoints.liepin.index===0,
  'a true Liepin auth redirect still stops the platform before collection or checkpoint advancement');
check(actualLogin.logs.some(x=>x.level==='warn'&&x.msg.includes('未执行'))
  &&!actualLogin.logs.some(x=>x.level==='success'&&x.msg.includes('未执行')),
  'unexecuted login-blocked collection is warning, never reported as success');
const actualChallenge=await harness('liepin','visual',{pageStatuses:[
  {readyState:'complete',cards:0,bodyLen:456,loginWall:false,collectionBlocked:'猎聘页面需要人工完成安全验证'},
]});
check(!actualChallenge.collectOptions.length&&actualChallenge.data.collectionCheckpoints.liepin.index===0
  &&actualChallenge.logs.some(x=>x.level==='warn'&&x.msg.includes('安全验证')),
  'Liepin verification remains a hard stop with its checkpoint retained');
console.log(`PASS collection traversal: ${checks} city-first queue, order-only migration and real visual/Camoufox runner checks across five platforms; zero platform requests.`);
