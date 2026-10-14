// Captured BOSS v2 identities/DTOs, real preload flow and native input dispatch. No platform network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
const { readBossChatContext, buildBossChatProbeScript, clickBossChatContact, buildBossChatContactClickScript, dispatchBossChatInput } = require(join(root, 'electron/preload/boss-chat-context.cjs'));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const href = 'https://www.zhipin.com/web/geek/chat';
const job = { jobId: 'job-A', encryptUserId: 'hr-A', url: 'https://www.zhipin.com/job_detail/job-A.html' };
const greeting = '有 Python 自动化开发实践，希望进一步沟通这个岗位。';
function fixture() {
  const sources = ['A', 'B'].map(id => ({ encryptJobId: `job-${id}`, encryptBossId: `hr-${id}`, jobId: `100${id}`, uid: `hr-native-${id}`, uniqueId: `hr-native-${id}_0`, name: '同名招聘者', brandName: '同一公司' }));
  const element = () => { const attrs = new Map(), classes = new Set(); return { isConnected: true, attrs,
    classList: { contains: s => classes.has(s), add: s => classes.add(s), remove: s => classes.delete(s) },
    setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k),
    scrollIntoView: () => {}, dispatchEvent: () => {}, matches: s => s !== 'textarea', innerText: '', value: '' }; };
  const rows = sources.map(source => { const r = element(); r.button = element(); r.__vue__ = { $props: { source, selected: '' } }; r.querySelector = s => s === '.friend-content' ? r.button : null; return r; });
  const input = element(), record = element(); record.messages = [];
  record.__vue__ = { $data: { boss: null, loading: false }, $store: { state: { userInfo: { userId: 'self' } } } };
  record.querySelectorAll = s => s === '.message-item' ? record.messages.map(message => ({ __vue__: { $props: { message } } })) : [];
  const list = element(); list.__vue__ = { $props: { dataSources: sources, estimateSize: 75 } }; list.scrollHeight = 3000; list.clientHeight = 300;
  const f = { sources, rows, input, record, list, selected: null, visibleRows: rows };
  const doc = { querySelectorAll: s => s === '.friend-content-warp' ? f.visibleRows
    : s === '[data-bossclaw-chat-target]' ? rows.map(r => r.button).filter(e => e.attrs.has('data-bossclaw-chat-target'))
    : s === '[data-bossclaw-chat-scroll]' ? [list].filter(e => e.attrs.has('data-bossclaw-chat-scroll')) : [],
    querySelector: s => s === '.user-list-content' ? list : s === '.chat-conversation .chat-record' ? record
    : s === '.chat-conversation #chat-input[contenteditable="true"]' ? f.selected !== null ? input : null
    : s.startsWith('[data-bossclaw-chat-target=') ? rows.find(r => r.button.getAttribute('data-bossclaw-chat-target') === s.split('"')[1])?.button || null
    : s.startsWith('[data-bossclaw-chat-scroll=') ? list : null };
  f.doc = doc;
  f.select = id => { f.selected = id; for (const r of rows) { r.__vue__.$props.selected = id === null ? '' : sources[id].uniqueId; r.button.classList.remove('selected'); } if (id !== null) rows[id].button.classList.add('selected'); record.__vue__.$data.boss = id === null ? null : sources[id]; };
  f.contactClicks = 0;
  rows.forEach((r, i) => { r.button.click = () => { f.contactClicks++; f.select(i); }; });
  f.read = options => readBossChatContext(doc, href, { ...job, greeting, ...options });
  f.select(0); return f;
}
{
  const f = fixture();
  check(f.read().ready, 'matching job/HR/selected row and native conversation are ready');
  check(!f.read().hasConversation, 'native relation/template messages alone are not real conversation');
  f.select(1); check(!f.read().ready && f.read().canClick, 'same company/name but different job/HR requires selection');
  f.read({ mark: true, marker: 'target' }); check(f.rows[0].button.getAttribute('data-bossclaw-chat-target') === 'target' && !f.rows[1].button.getAttribute('data-bossclaw-chat-target'), 'only the exact native target is marked');
  f.select(0); f.record.__vue__.$data.boss = f.sources[1]; check(!f.read().ready, 'selected target with stale conversation cannot send');
  f.record.__vue__.$data.boss = f.sources[0]; f.record.__vue__.$data.loading = true; check(!f.read().ready, 'history loading blocks input');
  f.record.__vue__.$data.loading = false; f.input.isConnected = false; check(!f.read().ready, 'detached editor is not ready'); f.input.isConnected = true;
  check(!readBossChatContext(f.doc, 'https://evil.invalid/web/geek/chat', job).ready, 'unrelated host is rejected');
  check(!f.read({ jobId: '', url: '' }).ready, 'missing target identifier is rejected');
  check(!f.read({ encryptUserId: 'hr-wrong' }).ready, 'conflicting expected HR identifier is rejected');
  check(f.read({ jobId: 'legacy-jobid' }).ready, 'verified detail URL provides the canonical job ID');
  f.list.__vue__.$props.dataSources.push({ ...f.sources[0], encryptBossId: 'another-hr', uniqueId: 'another_0' });
  check(!f.read({ encryptUserId: '' }).ready, 'ambiguous job-only match is rejected'); f.list.__vue__.$props.dataSources.pop();
  f.visibleRows = []; check(f.read({ mark: true }).canScroll, 'unrendered virtual target requests list scrolling'); f.visibleRows = f.rows;
  f.record.__vue__.$store.state.userInfo.userId = ''; check(!f.read().ready, 'missing current user identity blocks receipt verification'); f.record.__vue__.$store.state.userInfo.userId = 'self';
  f.record.messages = [{ type: 1, bodyType: 8, text: '', fromId: 'hr-native-A', received: true, mid: 1 }]; check(!f.read().hasConversation, 'system article is not plain conversation');
  f.record.messages = [{ type: 1, text: greeting, fromId: 'hr-native-A', received: true, mid: 1 }]; check(!f.read().hasExactGreeting && f.read().hasConversation, 'HR text cannot masquerade as our sent greeting');
  f.record.messages = [{ type: 1, text: greeting, fromId: 'self', received: false, mid: 0 }]; check(f.read().hasUnconfirmedGreeting && !f.read().hasExactGreeting, 'optimistic/pending own text does not count as sent');
  f.record.messages[0].received = true; check(!f.read().hasExactGreeting, 'receipt without a server message ID is insufficient');
  f.record.messages[0].mid = 42; check(f.read().hasExactGreeting, 'native own text plus acknowledgment/server ID confirms the exact greeting');
  f.record.messages[0].text = greeting.slice(0, 20); check(!f.read().hasExactGreeting, 'prefix overlap does not confirm a different message');
  const script = buildBossChatProbeScript(job, { greeting });
  check(vm.runInNewContext(script, { document: f.doc, location: { href }, URL }).ready, 'serialized production probe executes in the main world');
}
const source = ts.createSourceFile('webview.cjs', readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(); const visit = n => { if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(source)); ts.forEachChild(n, visit); }; visit(source);
{
  const f = fixture(); f.select(null);
  check(clickBossChatContact(f.doc, href, job).clicked && f.selected === 0, 'main-world contact click opens the exact matched native row without a foreground input channel');
  check(!clickBossChatContact(f.doc, href, job).clicked && f.contactClicks === 1, 'already selected and ready contact is not clicked again');
  f.select(null);
  check(!clickBossChatContact(f.doc, href, { ...job, jobId: 'other', url: 'https://www.zhipin.com/job_detail/other.html' }).clicked && f.contactClicks === 1, 'same company/name does not permit clicking a different job');
  check(!clickBossChatContact(f.doc, href, { ...job, encryptUserId: 'other' }).clicked && f.contactClicks === 1, 'mismatched recruiter cannot be selected');
  const script = buildBossChatContactClickScript(job, { marker: 'main-world-test' });
  check(vm.runInNewContext(script, { document: f.doc, location: { href }, URL }).clicked && f.selected === 0, 'serialized production click executes in the main world');
  f.select(null);
  const detached = clickBossChatContact(f.doc, href, job, (...args) => { const result = readBossChatContext(...args); f.rows[0].button.isConnected = false; return result; });
  check(!detached.clicked && f.contactClicks === 2, 'a recycled/detached contact row cannot be clicked');
}
async function flow(mode) {
  const f = fixture(); f.select(null); const stages = [], counts = { contacts: 0, inputs: 0, sends: 0, fallbacks: 0 };
  if (mode === 'prior') f.record.messages = [{ type: 1, fromId: 'self', text: greeting, received: true, mid: 42 }];
  if (mode === 'pending') f.record.messages = [{ type: 1, fromId: 'self', text: greeting, received: false, mid: 0 }];
  if (mode === 'conversation') f.record.messages = [{ type: 1, fromId: 'hr-native-A', text: '方便介绍一下项目吗？', received: true, mid: 41 }];
  for (const row of f.rows) { const select = row.button.click; row.button.click = () => { counts.contacts++;
    if (mode === 'no-open' || (mode === 'retry' && counts.contacts === 1)) return;
    select();
  }; }
  let clock = 0; class Clock extends Date { static now() { return clock; } }
  const button = { scrollIntoView() {} };
  const c = { Date: Clock, URL, document: f.doc, location: { href, pathname: '/web/geek/chat' },
    pageStatusData: () => ({ collectionBlocked: mode === 'blocked' }), normalizeChatText: t => String(t).replace(/\s+/g, ' ').trim(),
    bossChatContext: async (j, options) => readBossChatContext(f.doc, href, { ...j, ...options }),
    buildBossChatContactClickScript,
    webFrame: { executeJavaScript: async script => vm.runInNewContext(script, { document: f.doc, location: { href }, URL }) },
    chatInput: () => f.selected === null ? null : f.input,
    notify: (_, data) => stages.push(data), sleep: async ms => { clock += ms; }, jitterDelay: async ms => { clock += ms; },
    humanClickElement: async (element, options) => { if (element === button) { counts.sends++; if (mode !== 'no-receipt') f.record.messages.push({ type: 1, fromId: 'self', text: greeting, received: true, mid: 43 }); return true; } throw Error('Contact selection must not depend on a foreground native-input acknowledgment'); },
    enterChat: async () => null, trustedHoverElement: async () => {}, focusEditableScoped: element => element,
    trustedInput: async (action, text) => { if (action === 'insertText') { counts.inputs++; f.input.innerText = text; if (mode === 'changed') f.select(1); return { ok: true }; } return { ok: false }; },
    Event: class {}, InputEvent: class {}, setTimeout: () => 1, sendButton: () => button, isDisabledish: () => false,
    confirmOwnMessage: () => { throw Error('Whole-page confirmation is forbidden for full chat'); } };
  vm.createContext(c); for (const name of ['waitFor', 'bossChatContactClick', 'selectBossChatContact', 'domApplyOnce']) vm.runInContext(functions.get(name), c);
  await c.domApplyOnce({ job, greeting }); return { f, stages, counts };
}
for (const mode of ['new', 'prior', 'pending', 'conversation', 'changed', 'no-receipt', 'blocked', 'retry', 'no-open']) {
  const r = await flow(mode), last = r.stages.at(-1);
  if (mode === 'new') { check(r.counts.contacts === 1 && r.counts.sends === 1 && last.stage === 'verify_result', 'actual preload selects the contact then sends workbench text once'); check(r.f.input.innerText === greeting, 'workbench text is preserved'); }
  if (mode === 'prior') check(r.counts.inputs === 0 && r.counts.sends === 0 && last.stage === 'verify_result', 'verified identical greeting is not sent twice');
  if (mode === 'pending') check(r.counts.sends === 0 && last.stage === 'failed', 'unknown previous receipt is retained for review');
  if (mode === 'conversation') check(r.counts.sends === 0 && last.stage === 'continue_chat', 'actual conversation is handed to follow-up');
  if (mode === 'changed') check(r.counts.sends === 0 && last.stage === 'failed', 'switching contacts after fill cancels the send');
  if (mode === 'no-receipt') check(last.stage === 'failed', 'a click without an acknowledged target message cannot count as delivered');
  if (mode === 'blocked') check(r.counts.contacts === 0 && r.counts.inputs === 0 && r.counts.sends === 0 && last.stage === 'risk', 'security verification blocks all interaction');
  if (mode === 'retry') check(r.counts.contacts === 2 && r.counts.sends === 1 && last.stage === 'verify_result', 'an unhandled contact click is retried only after observing the conversation still unselected');
  if (mode === 'no-open') check(r.counts.contacts === 3 && r.counts.inputs === 0 && r.counts.sends === 0 && last.stage === 'failed' && /点击后会话未打开/.test(last.error), 'three unhandled clicks stop with a specific failure; click acknowledgment alone never starts message editing');
}
{
  const f = fixture(), events = [], failure = [];
  const wc = { executeJavaScript: async script => vm.runInNewContext(script, { document: f.doc, location: { href }, URL }) };
  dispatchBossChatInput(wc, job, () => events.push('send'), reason => failure.push(reason)); await new Promise(resolve => setImmediate(resolve));
  check(events.length === 1 && !failure.length, 'main-process dispatch accepts verified native context');
  f.select(1); dispatchBossChatInput(wc, job, () => events.push('wrong'), reason => failure.push(reason)); await new Promise(resolve => setImmediate(resolve));
  check(events.length === 1 && failure.length === 1, 'main-process dispatch cancels if contact changed during the mouse path');
  dispatchBossChatInput(wc, undefined, () => events.push('legacy'), reason => failure.push(reason));
  check(events.at(-1) === 'legacy', 'legacy/platform input without a BOSS guard retains its behavior');
}
{
  let fallbacks = 0;
  const c = { Date, recentClickAt: new Map(), clickedRecently: () => false, trustedClickElement: async () => false, clickElement: async () => { fallbacks++; } };
  vm.createContext(c); vm.runInContext(functions.get('humanClickElement'), c);
  await c.humanClickElement({}, { bossTarget: job }); check(fallbacks === 0, 'rejected native BOSS send guard cannot fall back to an unchecked DOM click');
  await c.humanClickElement({}); check(fallbacks === 1, 'contact selection and legacy buttons retain their DOM fallback');
}
const mainSource = ts.createSourceFile('main.cjs', readFileSync(join(root, 'electron/main.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let nativeListener;
const findListener = n => { if (ts.isCallExpression(n) && n.expression.getText(mainSource) === 'ipcMain.on' && n.arguments[0]?.text === 'jc:webview-input') nativeListener = n.arguments[1].getText(mainSource); ts.forEachChild(n, findListener); }; findListener(mainSource);
for (const mode of ['click-ok', 'changed-during-move', 'insert-wrong']) {
  const f = fixture(), events = [], replies = [];
  if (mode === 'insert-wrong') f.select(1);
  const wc = { id: 1, isDestroyed: () => false, once: () => {},
    executeJavaScript: async script => vm.runInNewContext(script, { document: f.doc, location: { href }, URL }),
    send: (_, result) => replies.push(result), insertText: text => events.push({ type: 'insert', text }),
    sendInputEvent: event => { events.push(event); if (mode === 'changed-during-move' && event.type === 'mouseMove') f.select(1); } };
  const context = { Date, Math, Number, String, Array, dispatchBossChatInput, inputWindowFor: () => [], inputWindows: new Map(), dlog: () => {}, setTimeout: fn => fn() };
  vm.createContext(context); vm.runInContext(`globalThis.handler=${nativeListener}`, context);
  context.handler({ sender: wc }, { seq: mode, action: mode === 'insert-wrong' ? 'insertText' : 'clickAt', text: greeting, bossTarget: job,
    x: 20, y: 30, path: [{ x: 10, y: 15, delayMs: 1 }, { x: 20, y: 30, delayMs: 1 }] });
  await new Promise(resolve => setImmediate(resolve));
  if (mode === 'click-ok') check(events.some(e => e.type === 'mouseDown') && replies.at(-1).ok, 'real main listener dispatches a verified send click');
  if (mode === 'changed-during-move') check(!events.some(e => e.type === 'mouseDown') && replies.at(-1).ok === false, 'real main listener rechecks after mouse movement and cancels wrong-target click');
  if (mode === 'insert-wrong') check(!events.some(e => e.type === 'insert') && replies.at(-1).ok === false, 'real main listener blocks typing into a changed contact');
}
console.log(`PASS BOSS native contact selection: ${checks} captured-contract/preload/input checks; no platform calls.`);
