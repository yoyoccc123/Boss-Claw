'use strict';
const { buildTextSendTargetScript } = require('./text-send-control.cjs');
// Captured BOSS v2: getGeekFriendList.json -> boss-item.source;
// geek/getBossData + historyMsg -> message-list.boss. Read identities only; never invoke SDK methods.
function readBossChatContext(doc, href, expected = {}) {
  const normalize = value => String(value || '').replace(/[\u200b\u200c\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const string = value => String(value ?? '').trim();
  const jobToken = value => string(value).replace(/^(?:encryptJobId|jobId|jobid)=/i, '').replace(/\.html$/i, '');
  let urlJob = '';
  try { urlJob = new URL(expected.url || '').pathname.match(/^\/job_detail\/([^/.?#]+)\.html?$/i)?.[1] || ''; } catch {}
  const jobId = urlJob || jobToken(expected.jobId), bossId = string(expected.encryptUserId);
  const fail = (reason, extra = {}) => ({ ready: false, reason, ...extra });
  try {
    const page = new URL(href);
    if (!/(^|\.)zhipin\.com$/i.test(page.hostname) || !/^\/web\/geek\/chat\/?$/.test(page.pathname)) return fail('不是 BOSS 联系人页面');
  } catch { return fail('不是 BOSS 联系人页面'); }
  if (!jobId) return fail('目标岗位编号缺失');
  const matches = source => source && (jobToken(source.encryptJobId) === jobId || string(source.jobId) === jobId)
    && (!bossId || string(source.encryptBossId) === bossId || string(source.uid) === bossId);
  const rows = [...doc.querySelectorAll('.friend-content-warp')].map(element => ({ element,
    source: element.__vue__?.$props?.source, selected: string(element.__vue__?.$props?.selected),
    button: element.querySelector('.friend-content') })).filter(row => row.source && row.button);
  const list = doc.querySelector('.user-list-content'), listProps = list?.__vue__?.$props;
  const models = Array.isArray(listProps?.dataSources) ? listProps.dataSources : rows.map(row => row.source);
  const targets = models.filter(matches);
  if (targets.length > 1) return fail('岗位对应多个联系人，需人工核对');
  if (!targets.length) return fail('联系人列表尚未找到目标岗位');
  const target = targets[0];
  const sameIdentity = (a, b) => a && b && string(a.encryptBossId) && string(a.encryptJobId) && string(a.uniqueId) && string(a.encryptBossId) === string(b.encryptBossId)
    && jobToken(a.encryptJobId) === jobToken(b.encryptJobId) && string(a.uniqueId) === string(b.uniqueId);
  const row = rows.find(r => sameIdentity(r.source, target));
  const token = string(expected.marker) || 'bossclaw-target';
  if (expected.mark) {
    for (const e of doc.querySelectorAll('[data-bossclaw-chat-target]')) e.removeAttribute('data-bossclaw-chat-target');
    for (const e of doc.querySelectorAll('[data-bossclaw-chat-scroll]')) e.removeAttribute('data-bossclaw-chat-scroll');
    row?.button.setAttribute('data-bossclaw-chat-target', token);
  }
  if (!row) {
    let scroller = list;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
    const index = models.indexOf(target), height = Number(listProps?.estimateSize) || 75;
    if (scroller && expected.mark) scroller.setAttribute('data-bossclaw-chat-scroll', token);
    return fail('目标联系人尚未滚动到可见区域', { scrollTop: index * height, canScroll: Boolean(scroller) });
  }
  const selected = rows.filter(r => r.button.classList.contains('selected') && r.selected === string(r.source.uniqueId));
  if (selected.length !== 1 || !sameIdentity(selected[0].source, target)) return fail('需要选中目标联系人', { canClick: true });
  const record = doc.querySelector('.chat-conversation .chat-record'), component = record?.__vue__;
  const conversation = component?.$data?.boss;
  if (!sameIdentity(conversation, target)) return fail('聊天区尚未切换到目标岗位', { canClick: false });
  if (component.$data.loading !== false) return fail('目标聊天记录仍在加载');
  const userId = string(component.$store?.state?.userInfo?.userId);
  if (!userId) return fail('当前用户编号尚未就绪');
  const messages = [...record.querySelectorAll('.message-item')].map(e => e.__vue__?.$props?.message);
  if (messages.some(m => !m)) return fail('聊天消息信息尚未就绪');
  // The v2 UI normalizes historyMsg's {from, body} into {fromId, text, received}.
  const textMessages = messages.filter(m => Number(m.type) === 1 && typeof m.text === 'string' && normalize(m.text));
  const exactGreeting = normalize(expected.greeting);
  const ownGreeting = textMessages.filter(m => exactGreeting && string(m.fromId) === userId && normalize(m.text) === exactGreeting);
  const hasExactGreeting = ownGreeting.some(m => m.received === true && string(m.mid) && string(m.mid) !== '0');
  const hasUnconfirmedGreeting = ownGreeting.length > 0 && !hasExactGreeting;
  const hasHrReply = Boolean(string(target.uid)) && textMessages.some(m => string(m.fromId) === string(target.uid) && string(m.fromId) !== userId);
  const hasConversation = hasHrReply || textMessages.some(m => string(m.fromId) === userId);
  const input = doc.querySelector('.chat-conversation #chat-input[contenteditable="true"]');
  if (!input || !input.isConnected) return fail('目标聊天输入框尚未就绪', { hasHrReply });
  return { ready: true, reason: '', hasExactGreeting, hasUnconfirmedGreeting, hasConversation, hasHrReply, jobId: string(conversation.encryptJobId), bossId: string(conversation.encryptBossId) };
}

function buildBossChatProbeScript(job = {}, options = {}) {
  const expected = { jobId: job.jobId, url: job.url, encryptUserId: job.encryptUserId,
    marker: options.marker, mark: Boolean(options.mark), greeting: options.greeting || '' };
  return `(${readBossChatContext.toString()})(document, location.href, ${JSON.stringify(expected)})`;
}

function clickBossChatContact(doc, href, expected = {}, readContext = readBossChatContext) {
  const marker = String(expected.marker || 'bossclaw-contact');
  const context = readContext(doc, href, { ...expected, marker, mark: true });
  if (context.ready) return { clicked: false, ready: true, reason: '' };
  if (!context.canClick) return { clicked: false, reason: context.reason };
  const target = [...doc.querySelectorAll('[data-bossclaw-chat-target]')]
    .find(e => e.getAttribute('data-bossclaw-chat-target') === marker);
  if (!target?.isConnected || typeof target.click !== 'function') return { clicked: false, reason: '联系人列表已更新，重新核对' };
  // Existing-contact selection is a normal Vue click handler. Execute in its main world;
  // an accepted sendInputEvent request does not prove that an unfocused guest received it.
  // Message editing/sending stays on the separately guarded trusted-input channel.
  try { target.click(); return { clicked: true, reason: '' }; }
  catch { return { clicked: false, reason: '目标联系人点击未完成' }; }
}

function buildBossChatContactClickScript(job = {}, options = {}) {
  const expected = { jobId: job.jobId, url: job.url, encryptUserId: job.encryptUserId, marker: options.marker };
  return `(()=>{const readBossChatContext=${readBossChatContext.toString()};return (${clickBossChatContact.toString()})(document,location.href,${JSON.stringify(expected)});})()`;
}

function dispatchBossChatInput(wc, target, action, rejected, inputIntent) {
  if (!target) { action(); return; }
  // This check runs after the mouse path, immediately before the physical input is issued.
  const script = inputIntent
    ? `(()=>{const context=${buildBossChatProbeScript(target)};if(!context.ready||context.hasHrReply)return context;return {...context,...${buildTextSendTargetScript(inputIntent)}};})()`
    : buildBossChatProbeScript(target);
  Promise.resolve().then(() => wc.executeJavaScript(script)).then(context => {
    if (context.hasHrReply) { rejected('HR 已回复，已跳过投递和招呼语发送', { skipped: true }); return; }
    if (!context?.ready) { rejected(context?.reason || 'BOSS 当前会话已改变，已取消输入或发送'); return; }
    action(context);
  }).catch(() => rejected('BOSS 会话核对失败，已取消输入或发送'));
}

module.exports = { readBossChatContext, buildBossChatProbeScript, clickBossChatContact, buildBossChatContactClickScript, dispatchBossChatInput };
