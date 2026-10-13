'use strict';
// Official PC IM templates: im.web.2bca2b9ffb60625760e65ba5af18661d.js.
// DOM only. Never inspect Vue private state or invoke a platform send API.
const normalize = value => String(value || '').replace(/\s+/g, '').trim();
const titleKey = value => normalize(value).replace(/^(职位|岗位)[：:]/, '').replace(/[【\[].*?[】\]]/g, '').replace(/（[^）]*(?:区|市|地点)[^）]*）/g, '');
function visible(el) {
  if (!el || !el.isConnected) return false;
  for (let p = el; p?.nodeType === 1; p = p.parentElement) {
    const s = p.ownerDocument.defaultView.getComputedStyle(p);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  }
  const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
}
const nodes = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const text = el => String(el?.innerText || el?.textContent || '').trim();
function readZhaopinHistory(doc) {
  const timelines = nodes(doc, '.im-main-panel__timeline');
  if (timelines.length !== 1) return { ready: false, reason: '消息区尚未就绪' };
  const timeline = timelines[0], tips = nodes(timeline, '.im-main-panel__tip');
  if (nodes(timeline, '.im-main-panel__history-tip.is-loading').length || tips.some(el => /加载中/.test(text(el)))) return { ready: false, reason: '聊天历史仍在加载' };
  if (tips.some(el => normalize(text(el)) !== normalize('暂无消息，打个招呼吧'))) return { ready: false, reason: '聊天历史未成功加载，请人工核对' };
  const ready = nodes(timeline, '.im-message').length > 0 || tips.some(el => normalize(text(el)) === normalize('暂无消息，打个招呼吧'));
  return { ready, reason: ready ? '' : '聊天历史加载结果未确认' };
}
function sessionIdFromUrl(href) {
  try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'i.zhaopin.com' && /^\/im\/?$/.test(u.pathname)
    ? u.searchParams.get('sessionId') || u.searchParams.get('sessionid') || '' : ''; } catch { return ''; }
}
function readZhaopinChat(doc, href, job = {}, expectedSessionId = '') {
  const sessionId = sessionIdFromUrl(href), fail = reason => ({ ready: false, sessionId, reason });
  if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId)) return fail('聊天会话链接未确认或已变化');
  const history = readZhaopinHistory(doc); if (!history.ready) return fail(history.reason);
  const headers = nodes(doc, '.im-chat-header'), selected = nodes(doc, '.im-session-item.is-active');
  if (headers.length !== 1 || selected.length !== 1) return fail('未找到唯一的当前会话');
  const header = headers[0], entry = selected[0];
  const name = text(header.querySelector('.im-chat-header__name'));
  const company = text(header.querySelector('.im-chat-header__meta-text'));
  const title = text(header.querySelector('.im-chat-header__job-title'));
  if (!normalize(job.company) || !titleKey(job.title) || normalize(company) !== normalize(job.company) || titleKey(title) !== titleKey(job.title)) return fail('聊天中的公司或岗位与目标不一致');
  if (normalize(text(entry.querySelector('.im-session-item__company-name'))) !== normalize(company)
    || titleKey(text(entry.querySelector('.im-session-item__job'))) !== titleKey(title)
    || normalize(text(entry.querySelector('.im-session-item__name'))) !== normalize(name)) return fail('选中会话与聊天标题不一致');
  if (job.recruiterName && normalize(job.recruiterName) !== normalize(name)) return fail('聊天招聘方与目标不一致');
  const panels = nodes(doc, '.im-main-panel'), editors = nodes(doc, 'textarea.im-sender__input');
  if (panels.length !== 1 || editors.length !== 1 || editors[0].disabled) return fail('聊天输入框尚未就绪');
  const panel = panels[0], editor = editors[0];
  if (!panel.contains(editor) || nodes(panel, '.im-main-panel__timeline').length !== 1) return fail('聊天消息区尚未就绪');
  return { ready: true, sessionId, header, panel, editor, signature: [sessionId, name, company, title].map(normalize).join('|') };
}
function readZhaopinDeliveryState(target, greeting = '', defaultGreeting = '') {
  // The official job-page modal's fallback sentence is also recognized for older deliveries.
  // Dynamic prologues require the exact text captured from this job's native success modal.
  const wanted = normalize(greeting), knownDefault = normalize(defaultGreeting || '您好，我对这个职位很感兴趣，想进一步了解一下。');
  const rows = nodes(target.panel.querySelector('.im-main-panel__timeline'), '.im-message__bubble');
  const outgoing = [], incoming = [], matching = [], nonDefaultOutgoing = [];
  for (const bubble of rows) {
    const body = normalize(text(bubble.querySelector('.im-message__bubble-inner') || bubble));
    if (!body) continue;
    const row = bubble.closest('.im-message') || bubble.parentElement;
    if (row?.matches('.im-message--tip')) continue;
    if (bubble.classList.contains('im-message__bubble--me') && row?.matches('.im-message--image, .im-message--custom')) continue;
    const state = row?.querySelector('.im-message__send-state');
    const unconfirmed = !!row?.querySelector('.im-message__fail-btn') || (!!state && !/^(已发送|发送成功)$/.test(normalize(text(state))));
    if (bubble.classList.contains('im-message__bubble--me')) {
      outgoing.push(bubble);
      const receipt = normalize(text(row?.querySelector('.im-message__receipt')));
      if (wanted && body === wanted && !unconfirmed && /^(送达|已读)$/.test(receipt)) matching.push(bubble);
      else if (!(knownDefault && body === knownDefault)) nonDefaultOutgoing.push(bubble);
    } else incoming.push(bubble);
  }
  const buttons = nodes(target.panel, 'button.im-sender__send-btn').filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && normalize(text(el)) === '发送');
  return { outgoing, incoming, matching, nonDefaultOutgoing, editorText: String(target.editor.value || '').trim(), sendButton: buttons.length === 1 ? buttons[0] : null };
}
module.exports = { readZhaopinChat, readZhaopinDeliveryState, readZhaopinHistory, sessionIdFromUrl };
