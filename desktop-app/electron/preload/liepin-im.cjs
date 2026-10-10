'use strict';

// 只读猎聘 IM：挂载点/「我的沟通」入口存在，不等于本次会话已打开。
// 支持同一页面的多个窗口、无尺寸的挂载点、开放 shadow root 和同源子框架。
function readLiepinImState(doc) {
  const widgets = [];
  const seen = new Set();
  let rootsSeen = 0;
  let inaccessibleFrames = 0;
  const query = (root, selector) => {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  };
  const text = (el) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    try {
      let node = el;
      while (node) {
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true'
          || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        node = node.parentElement || node.getRootNode()?.host;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch { return false; }
  };
  const readWidget = (root, modal) => {
    if (widgets.some((widget) => widget.element === root)) return;
    const editor = query(root, 'textarea, [contenteditable="true"], [role="textbox"][aria-multiline="true"], #chat-input')
      .find((el) => shown(el) && !el.disabled && !el.readOnly
        && !/搜索|查找|search/i.test([el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('type')].join(' ')));
    const rendered = modal && [root, ...query(root, '*')].some((el) => shown(el) && text(el));
    if (!editor && !rendered) return;
    const heading = query(root, '[class*="header"], [class*="title"], [role="heading"]')
      .filter((el) => shown(el) && !String(el.className).includes('im-ui-basic-entry'))
      .slice(0, 6).map((el) => text(el).slice(0, 80)).join('|');
    widgets.push({ element: root, heading });
  };
  const inspect = (scope, insideIm = false) => {
    if (!scope || seen.has(scope) || seen.size >= 40) return;
    seen.add(scope);
    if (insideIm) readWidget(scope, false);
    if (scope.shadowRoot) inspect(scope.shadowRoot, insideIm);
    for (const root of query(scope, '#im-c-entry, [class*="im-ui-chat-modal"]')) {
      rootsSeen += 1;
      readWidget(root, String(root.className).includes('im-ui-chat-modal'));
      inspect(root, true);
    }
    for (const el of query(scope, '*')) {
      if (el.shadowRoot) inspect(el.shadowRoot, insideIm);
      if (insideIm && el.tagName === 'IFRAME' && shown(el)) {
        try {
          const child = el.contentDocument;
          if (child) inspect(child, true);
          else inaccessibleFrames += 1;
        } catch { inaccessibleFrames += 1; }
      }
    }
  };
  inspect(doc);
  return { widgets, rootsSeen, inaccessibleFrames };
}

function hasNewLiepinConversation(before, after) {
  return after.widgets.some((current) => {
    const previous = before.widgets.find((old) => old.element === current.element);
    return !previous || Boolean(current.heading && previous.heading && current.heading !== previous.heading);
  });
}

module.exports = { readLiepinImState, hasNewLiepinConversation };
