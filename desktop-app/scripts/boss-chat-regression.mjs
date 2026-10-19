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
const { isTextSendControl, findTextSendButton, readTextSendTarget } = require(join(root, 'electron/preload/text-send-control.cjs'));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const href = 'https://www.zhipin.com/web/geek/chat';
const job = { jobId: 'job-A', encryptUserId: 'hr-A', url: 'https://www.zhipin.com/job_detail/job-A.html' };
const greeting = '有 Python 自动化开发实践，希望进一步沟通这个岗位。';
const statusContract = JSON.parse(readFileSync(join(root, 'scripts/fixtures/boss-message-status-contract.json'), 'utf8'));
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
  const send = element(); Object.assign(send, { tagName: 'BUTTON', className: 'btn-v2 btn-send', innerText: '发送',
    getBoundingClientRect: () => ({ left: 170, top: 10, width: 60, height: 40 }), querySelector: () => null, closest: () => null, contains: hit => hit === send });
  const image = element(); Object.assign(image, { tagName: 'DIV', className: 'toolbar-btn-content btn-sendimg', innerText: '',
    getBoundingClientRect: () => ({ left: 0, top: 10, width: 40, height: 40 }), querySelector: () => null, closest: () => null }); image.setAttribute('aria-label', '发送图片');
  const scope = { querySelectorAll: () => [image, send] };
  input.closest = () => scope; input.contains = hit => hit === input; input.innerText = greeting;
  const f = { sources, rows, input, record, list, send, image, scope, hit: send, selected: null, visibleRows: rows };
  const doc = { querySelectorAll: s => s === '.friend-content-warp' ? f.visibleRows
    : s === '[data-bossclaw-text-send]' ? [send].filter(e => e.attrs.has('data-bossclaw-text-send'))
    : s === '[data-bossclaw-chat-target]' ? rows.map(r => r.button).filter(e => e.attrs.has('data-bossclaw-chat-target'))
    : s === '[data-bossclaw-chat-scroll]' ? [list].filter(e => e.attrs.has('data-bossclaw-chat-scroll')) : [],
    querySelector: s => s === '.user-list-content' ? list : s === '.chat-conversation .chat-record' ? record
    : s === '.chat-conversation #chat-input[contenteditable="true"]' ? f.selected !== null ? input : null
    : s.startsWith('[data-bossclaw-chat-target=') ? rows.find(r => r.button.getAttribute('data-bossclaw-chat-target') === s.split('"')[1])?.button || null
    : s.startsWith('[data-bossclaw-chat-scroll=') ? list : null,
    activeElement: input, elementFromPoint: () => f.hit,
    defaultView: { innerWidth: 1000, innerHeight: 600, getComputedStyle: () => ({display:'block',visibility:'visible'}) } };
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
  check(f.read().hasHrReply, 'HR-authored text is a reply');
  f.input.isConnected = false; check(f.read().hasHrReply && !f.read().ready, 'HR reply can skip even if the editor is unavailable'); f.input.isConnected = true;
  f.record.messages = [{ type: 4, bodyType: 16, text: '你与该职位竞争者PK情况', fromId: 'hr-native-A', received: true, mid: 1 }]; check(!f.read().hasHrReply, 'captured platform competition card is not an HR reply');
  f.record.messages = [{ type: 1, text: greeting, fromId: 'self', received: false, mid: 0 }]; check(f.read().hasUnconfirmedGreeting && !f.read().hasExactGreeting, 'optimistic/pending own text does not count as sent');
  f.record.messages[0].received = true; check(!f.read().hasExactGreeting, 'receipt without a server message ID is insufficient');
  f.record.messages[0].mid = 42; check(f.read().hasExactGreeting, 'native own text plus acknowledgment/server ID confirms the exact greeting');
  f.input.isConnected = false;
  check(!f.read().ready && readBossChatContext(f.doc, href, { ...job, greeting, readOnly: true }).hasExactGreeting, 'receipt confirmation does not require an editor, but input dispatch still does');
  f.select(1); check(!readBossChatContext(f.doc, href, { ...job, greeting, readOnly: true }).ready, 'read-only receipt cannot use the wrong target');
  f.select(0); f.input.isConnected = true;
  f.record.messages[0].text = greeting.slice(0, 20); check(!f.read().hasExactGreeting, 'prefix overlap does not confirm a different message');
  const script = buildBossChatProbeScript(job, { greeting });
  check(vm.runInNewContext(script, { document: f.doc, location: { href }, URL }).ready, 'serialized production probe executes in the main world');
}
const source = ts.createSourceFile('webview.cjs', readFileSync(join(root, 'electron/preload/webview.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
{
  const f = fixture();
  for (const [status, className] of Object.entries(statusContract.messageStatus)) {
    f.record.messages = [{ type: 1, bodyType: 1, text: greeting, fromId: 'self', received: true, mid: 43, status: Number(status) }];
    const delivered = ['status-delivery', 'status-read'].includes(className);
    check(f.read().hasExactGreeting === delivered, 'receipt agrees with captured frontend status, never received=true alone: ' + status);
    f.record.messages[0].received = false;
    check(f.read().hasExactGreeting === delivered, 'live delivered/read receipt does not depend on the separate received flag: ' + status);
    delete f.record.messages[0].received;
    check(f.read().hasExactGreeting === delivered, 'missing received flag does not hide a native receipt: ' + status);
  }
  f.record.messages = [{ type: 1, text: greeting, fromId: 'self', status: 1, mid: 43 }];
  check(f.read().greetingReceipt === 'delivered', 'native delivered state is recorded');
  f.record.__vue__.$data.loading = true;
  check(!f.read().ready && readBossChatContext(f.doc, href, { ...job, greeting, readOnly: true }).hasExactGreeting, 'history loading cannot hide a proven receipt, and still blocks writing');
  f.record.__vue__.$data.loading = false; f.record.messages.push(undefined);
  check(!f.read().ready && readBossChatContext(f.doc, href, { ...job, greeting, readOnly: true }).hasExactGreeting, 'unrelated incomplete history cannot hide a proven receipt, and still blocks writing');
  for (const mid of [0, -43, '', undefined, 'temporary-id']) {
    f.record.messages = [{ type: 1, text: greeting, fromId: 'self', status: 1, mid }];
    check(!f.read().hasExactGreeting, 'temporary/missing message IDs are never accepted: ' + mid);
  }
  f.record.messages = [{ type: 1, text: greeting, fromId: 'hr-native-A', status: 1, mid: 43 }];
  check(!f.read().hasExactGreeting, 'HR echo of the complete greeting is not our outgoing receipt');
  f.record.messages = [{ type: 1, text: greeting, fromId: 'self', status: 99, received: true, mid: 43 }];
  check(!f.read().hasExactGreeting, 'unknown future status cannot be guessed successful');
}
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
  if (mode === 'conversation' || mode === 'reply-after-prior') f.record.messages = [{ type: 1, fromId: 'hr-native-A', text: '方便介绍一下项目吗？', received: true, mid: 41 }];
  if (mode === 'reply-after-prior') f.record.messages.push({ type: 1, fromId: 'self', text: greeting, received: true, mid: 42 });
  for (const row of f.rows) { const select = row.button.click; row.button.click = () => { counts.contacts++;
    if (mode === 'no-open' || (mode === 'retry' && counts.contacts === 1)) return;
    select();
  }; }
  let clock = 0, receiptAt = Infinity; class Clock extends Date { static now() { return clock; } }
  const tick = async ms => { clock += ms; if (clock >= receiptAt) { receiptAt = Infinity; f.record.messages.push({ type: 1, fromId: 'self', text: greeting, received: true, mid: 43 }); } };
  const button = f.send;
  const c = { Date: Clock, URL, document: f.doc, location: { href, pathname: '/web/geek/chat' },
    pageStatusData: () => ({ collectionBlocked: mode === 'blocked' }), normalizeChatText: t => String(t).replace(/\s+/g, ' ').trim(),
    bossChatContext: async (j, options) => { if(mode==='receipt-probe-error' && counts.sends)throw Error('fixture receipt bridge unavailable'); return readBossChatContext(f.doc, href, { ...j, ...options }); },
    buildBossChatContactClickScript,
    webFrame: { executeJavaScript: async script => vm.runInNewContext(script, { document: f.doc, location: { href }, URL }) },
    chatInput: () => f.selected === null ? null : f.input,
    notify: (_, data) => stages.push(data), sleep: tick, jitterDelay: tick,
    humanClickElement: async (element, options) => { if (element === button) { if(mode==='reply-during-click') throw Error('BOSS_HR_REPLIED'); counts.sends++; if(mode==='click-timeout')throw Error('input timeout'); if(mode==='delayed')receiptAt=clock+12000; else if (mode !== 'no-receipt') f.record.messages.push(['live-status','read-status','loading-history','partial-history','failed-status'].includes(mode)
      ? {type:1,bodyType:1,fromId:'self',text:greeting,status:mode==='read-status'?2:mode==='failed-status'?4:1,received:false,mid:43}
      : { type: 1, fromId: 'self', text: greeting, received: true, mid: 43 }); if(mode==='loading-history')f.record.__vue__.$data.loading=true; if(mode==='partial-history')f.record.messages.push(undefined); if(mode==='editor-gone')f.input.isConnected=false; if(mode==='wrong-after-send')f.select(1); return true; } throw Error('Contact selection must not depend on a foreground native-input acknowledgment'); },
    enterChat: async () => null, trustedHoverElement: async () => {}, focusEditableScoped: element => element,
    trustedInput: async (action, text) => { if (action === 'insertText') { counts.inputs++; if(mode==='reply-before-fill') return {ok:false,skipped:true}; f.input.innerText = text; if (mode === 'changed') f.select(1); if(mode==='reply-after-fill')f.record.messages.push({type:1,fromId:'hr-native-A',text:'你好',mid:44,received:true}); return { ok: true }; } return { ok: false }; },
    Event: class {}, InputEvent: class {}, setTimeout: () => 1, sendButton: () => button, isDisabledish: () => false,
    confirmOwnMessage: () => { throw Error('Whole-page confirmation is forbidden for full chat'); } };
  vm.createContext(c); for (const name of ['waitFor', 'bossChatContactClick', 'selectBossChatContact', 'domApplyOnce']) vm.runInContext(functions.get(name), c);
  await c.domApplyOnce({ job, greeting }); return { f, stages, counts };
}
for (const mode of ['new', 'prior', 'pending', 'conversation', 'reply-after-prior', 'reply-before-fill', 'reply-after-fill', 'reply-during-click', 'changed', 'no-receipt', 'blocked', 'retry', 'no-open', 'delayed', 'editor-gone', 'wrong-after-send', 'click-timeout', 'live-status', 'read-status', 'loading-history', 'partial-history', 'failed-status', 'receipt-probe-error']) {
  const r = await flow(mode), last = r.stages.at(-1);
  if (mode === 'new') { check(r.counts.contacts === 1 && r.counts.sends === 1 && last.stage === 'verify_result', 'actual preload selects the contact then sends workbench text once'); check(r.f.input.innerText === greeting, 'workbench text is preserved'); }
  if (mode === 'prior') check(r.counts.inputs === 0 && r.counts.sends === 0 && last.stage === 'verify_result', 'verified identical greeting is not sent twice');
  if (mode === 'pending') check(r.counts.sends === 0 && last.stage === 'failed' && last.needsReview, 'unknown previous receipt is retained for review');
  if (mode === 'conversation' || mode.startsWith('reply-')) check(r.counts.sends === 0 && last.stage === 'skipped', 'HR reply skips application and greeting rather than handing it to follow-up: '+mode);
  if (mode === 'changed') check(r.counts.sends === 0 && last.stage === 'failed', 'switching contacts after fill cancels the send');
  if (['no-receipt','wrong-after-send','click-timeout'].includes(mode)) check(last.stage === 'failed' && last.needsReview && last.sendAttempted, 'post-send uncertainty cannot count as failure eligible for resend: '+mode);
  if (['delayed','editor-gone'].includes(mode)) check(last.stage === 'verify_result' && r.counts.sends === 1, 'late receipt/editor lifecycle cannot cause false failure or resend: '+mode);
  if (['live-status','read-status','loading-history','partial-history'].includes(mode)) check(last.stage === 'verify_result' && r.counts.sends === 1, 'actual send flow confirms native delivered/read status without hydration dependencies: '+mode);
  if (mode === 'failed-status') check(last.stage === 'failed' && last.needsReview && r.counts.sends === 1 && /消息状态/.test(last.error), 'explicit send error is not counted as delivered and reports the native status');
  if (mode === 'receipt-probe-error') check(last.stage === 'failed' && last.needsReview && /fixture receipt bridge unavailable/.test(last.error), 'bridge errors retain their cause instead of silently becoming a generic receipt timeout');
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
for (const mode of ['click-ok', 'changed-during-move', 'insert-wrong', 'image-overlay', 'partial-overlay', 'reply-during-move', 'wrong-focus', 'changed-draft']) {
  const f = fixture(), events = [], replies = [];
  if (mode === 'insert-wrong') f.select(1);
  if (mode === 'image-overlay') f.hit = f.image;
  if (mode === 'partial-overlay') f.doc.elementFromPoint = x => x > 220 ? f.send : f.image;
  if (mode === 'wrong-focus') f.doc.activeElement = f.image;
  if (mode === 'changed-draft') f.input.innerText = '另一个岗位的草稿';
  f.send.setAttribute('data-bossclaw-text-send','fixture-send');
  const wc = { id: 1, isDestroyed: () => false, once: () => {},
    executeJavaScript: async script => vm.runInNewContext(script, { document: f.doc, location: { href }, URL }),
    send: (_, result) => replies.push(result), insertText: text => events.push({ type: 'insert', text }),
    sendInputEvent: event => { events.push(event); if (mode === 'changed-during-move' && event.type === 'mouseMove') f.select(1); if(mode==='reply-during-move' && event.type==='mouseMove')f.record.messages=[{type:1,text:'你好',fromId:'hr-native-A',mid:45,received:true}]; } };
  const context = { Date, Math, Number, String, Array, dispatchBossChatInput, inputWindowFor: () => [], inputWindows: new Map(), dlog: () => {}, setTimeout: fn => fn() };
  vm.createContext(context); vm.runInContext(`globalThis.handler=${nativeListener}`, context);
  context.handler({ sender: wc }, { seq: mode, action: ['insert-wrong','wrong-focus'].includes(mode) ? 'insertText' : 'clickAt', text: greeting, bossTarget: job, bossInput:{marker:'fixture-send',greeting},
    x: 20, y: 30, path: [{ x: 10, y: 15, delayMs: 1 }, { x: 20, y: 30, delayMs: 1 }] });
  await new Promise(resolve => setImmediate(resolve));
  if (mode === 'click-ok') check(events.some(e => e.type === 'mouseDown' && e.x === 200 && e.y === 30) && replies.at(-1).ok, 'real main listener replaces stale image coordinates with the live text-send center');
  if (mode === 'partial-overlay') check(events.some(e => e.type === 'mouseDown' && e.x === 221) && replies.at(-1).ok, 'partially obscured text-send control uses an exposed point belonging to that exact button');
  if (mode === 'changed-during-move') check(!events.some(e => e.type === 'mouseDown') && replies.at(-1).ok === false, 'real main listener rechecks after mouse movement and cancels wrong-target click');
  if (mode === 'insert-wrong') check(!events.some(e => e.type === 'insert') && replies.at(-1).ok === false, 'real main listener blocks typing into a changed contact');
  if (['image-overlay','reply-during-move','wrong-focus','changed-draft'].includes(mode)) check(!events.some(e => ['insert','mouseDown'].includes(e.type)) && replies.at(-1).ok === false, 'real main listener rejects unsafe input/send: '+mode);
  if(mode==='reply-during-move')check(replies.at(-1).skipped===true,'reply arriving during movement produces a skip terminal result');
}
{
 const f=fixture();
 check(!isTextSendControl(f.image) && findTextSendButton(f.doc,f.input)===f.send,'captured btn-sendimg toolbar cannot be mistaken for btn-send');
 f.image.innerText='发送'; check(!isTextSendControl(f.image),'an upload control with a misleading visible label is rejected');
 f.send.setAttribute('data-bossclaw-text-send','fixture-send');
 check(readTextSendTarget(f.doc,{action:'clickAt',marker:'fixture-send',greeting}).ready,'marked exact text button and complete draft permit send');
 f.hit=f.image;check(!readTextSendTarget(f.doc,{action:'clickAt',marker:'fixture-send',greeting}).ready,'actual hit must belong to the text button');
}
{
  const c={lastCursor:null,jitterDelay:async()=>{},sleep:async()=>{},elementCenter:()=>({x:20,y:30}),humanize:{buildMousePath:()=>[],settleDelayMs:()=>0},
    trustedInput:async()=>({ok:false,error:'文字发送按钮被遮挡，未找到可安全点击的位置，已保留草稿'})};
  vm.createContext(c);vm.runInContext(functions.get('trustedClickElement'),c);
  await assert.rejects(()=>c.trustedClickElement({scrollIntoView(){}},{bossTarget:job}),/未找到可安全点击的位置/);checks++;
  c.trustedInput=async()=>({ok:false,error:'timeout'});
  await assert.rejects(()=>c.trustedClickElement({scrollIntoView(){}},{bossTarget:job}),/timeout/);checks++;
  c.trustedInput=async()=>({ok:false,skipped:true});
  await assert.rejects(()=>c.trustedClickElement({scrollIntoView(){}},{bossTarget:job}),/BOSS_HR_REPLIED/);checks++;
  c.elementCenter=()=>null;
  await assert.rejects(()=>c.trustedClickElement({scrollIntoView(){}},{bossTarget:job}),/移出视口/);checks++;
}
console.log(`PASS BOSS native contact selection: ${checks} captured-contract/preload/input checks; no platform calls.`);
await import('./boss-send-ui-regression.mjs');
