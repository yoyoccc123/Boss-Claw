import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const P = require(join(root, 'electron/preload/random-wait.cjs'));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
check(JSON.stringify(P.normalizeRandomWaits()) === JSON.stringify(P.DEFAULT_RANDOM_WAITS), 'old profiles receive independent defaults');
const dirty = P.normalizeRandomWaits({ collectionJob: { minSeconds: 8, maxSeconds: 3 }, collectionStep: { minSeconds: NaN, maxSeconds: Infinity }, deliveryStep: { minSeconds: -5, maxSeconds: 999 } });
check(dirty.collectionJob.minSeconds === 8 && dirty.collectionJob.maxSeconds === 8, 'reversed ranges cannot produce negative waits');
check(dirty.collectionStep.minSeconds === 0.8 && dirty.collectionStep.maxSeconds === 2, 'nonfinite values fall back safely');
check(dirty.deliveryStep.minSeconds === 0 && dirty.deliveryStep.maxSeconds === 15, 'step waits have finite bounds');
for (const key of Object.keys(P.DEFAULT_RANDOM_WAITS)) {
  const range = P.DEFAULT_RANDOM_WAITS[key];
  check(P.sampleWaitMs(range, () => 0) === range.minSeconds * 1000, key + ' samples lower bound');
  check(P.sampleWaitMs(range, () => 1) === range.maxSeconds * 1000, key + ' samples upper bound');
  check(P.sampleWaitMs({ minSeconds: 0, maxSeconds: 0 }) === 0, key + ' can be explicitly disabled');
}
let clock = 0, stopped = false, paused = false, pausedTicks = 0;
check(await P.waitInterruptibly(350, { now: () => clock, sleep: async ms => { clock += ms; } }), 'normal wait completes');
check(clock === 350, 'wait preserves sampled duration instead of resampling each poll');
clock = 0;
check(!await P.waitInterruptibly(5000, { stopped: () => stopped, now: () => clock, sleep: async ms => { clock += ms; stopped = true; } }), 'Stop cancels a long wait');
check(clock <= 100, 'Stop does not wait for the whole configured delay');
stopped = false; paused = true; clock = 0;
check(await P.waitInterruptibly(350, { paused: () => paused, now: () => clock, sleep: async ms => { clock += ms; if (++pausedTicks === 3) paused = false; } }), 'paused wait resumes');
check(clock === 650, 'pause time does not consume the remaining wait');

function functions(file) {
  const source = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const out = new Map();
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name) out.set(node.name.text, node.getText(source));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) out.set(node.name.text, `const ${node.name.text}=${node.initializer.getText(source)};`);
    ts.forEachChild(node, walk);
  }
  walk(source); return out;
}
const preload = functions('electron/preload/webview.cjs'), wb = functions('src/pages/Workbench.tsx');
const tokens = new Set(), events = [];
clock = 0;
const c = { cancelledApplyTokens: tokens, notify: (_channel, data) => events.push(data),
  randomWait: { ...P, waitInterruptibly: (ms, options) => P.waitInterruptibly(ms, { ...options, now: () => clock, sleep: async n => { clock += n; tokens.add('old'); } }) } };
vm.createContext(c); vm.runInContext(preload.get('deliveryStepWait'), c);
await assert.rejects(c.deliveryStepWait({ pacingToken: 'old', randomWaits: P.DEFAULT_RANDOM_WAITS }, '发送前'), /DELIVERY_CANCELLED/); checks++;
check(events.length === 1 && events[0].waitMs >= 1000 && events[0].waitMs <= 3000, 'actual guest wait reports its sampled seconds');
check(clock === 100, 'actual guest wait honors the matching Stop token');
await c.deliveryStepWait({ pacingToken: 'new', randomWaits: { deliveryStep: { minSeconds: 0, maxSeconds: 0 } } }, 'next');
check(clock === 100, 'old Stop token cannot cancel a later job');
const collectNotices = [], collectedWaits = [], ctl = { randomWaits: P.DEFAULT_RANDOM_WAITS, paused: false };
const collector = { collectCtl: ctl, randomWait: { ...P, sampleWaitMs: range => range.minSeconds * 1000,
  waitInterruptibly: async ms => { collectedWaits.push(ms); return true; } } };
vm.createContext(collector);vm.runInContext(preload.get('collectionRandomWait'), collector);
const nextWait = collector.collectionRandomWait({ randomWaits: P.DEFAULT_RANDOM_WAITS }, () => false, (_channel,data) => collectNotices.push(data));
await nextWait('collectionJob','next');
ctl.randomWaits = { collectionJob: { minSeconds: 8, maxSeconds: 9 } };
await nextWait('collectionJob','next');
check(collectedWaits.join() === '3000,8000' && collectNotices.at(-1).waitMs === 8000, 'actual collection pacing reads edited settings for the next wait without resampling the active pause');

let running = true, tick = 100000, waited = 0;
const host = { Date: { now: () => tick }, Math, Number, canContinueDelivery: () => running,
  useSettingsStore: { getState: () => ({ config: { betweenJobsSeconds: 20, maxActionsPerMinute: 6 } }) },
  markDelivered: () => 1, batchRestDelayMs: () => 0, resetDeliveredSinceRest: () => {},
  sharedPacer: () => ({ waitForSlot: async () => {} }), humanDelayMs: () => 20000,
  SAFETY_LIMITS: { MIN_BETWEEN_JOBS_MS: 15000 }, lastDeliveryAt: { current: 1000 }, addLog: () => {},
  sleep: async ms => { waited += ms; tick += ms; } };
vm.createContext(host); vm.runInContext((await transform(wb.get('awaitDeliveryGap'), { loader: 'tsx' })).code, host);
check(await vm.runInContext('awaitDeliveryGap(1)', host), 'actual delivery gap completes');
check(waited === 20000, 'long previous processing no longer subtracts the next job random pause');
waited = 0; host.sleep = async ms => { waited += ms; tick += ms; running = false; };
check(!await vm.runInContext('awaitDeliveryGap(1)', host) && waited <= 250, 'Stop interrupts the actual full between-job pause');
console.log(`PASS random pacing: ${checks} range, pause/Stop, token isolation and actual delivery-gap checks; zero platform requests.`);
