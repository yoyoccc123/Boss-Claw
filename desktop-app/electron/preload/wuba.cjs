'use strict';

// 58 job-page DOM contract. No network writes, login automation or CAPTCHA interaction.
const APPLY = ['申请职位', '立即申请', '投递简历', '立即投递'];
const ALREADY = ['已申请', '已投递', '申请成功', '投递成功'];
const ACTIONS = '.pos_operate .applyJobBtn, .applyJobBtn';
const JOB_BODY = '.des, .job_des, .job-description, [itemprop="description"]';
const PANELS = '[role="dialog"], [role="alert"], .win_tip, .apply_success, .apply-success, .success_tip, .toast, .dialog, .modal, .guide-box, .pop_container';
const compact = v => String(v || '').replace(/\s+/g, '').trim();
const text = el => {
  if (el?.innerText) return String(el.innerText).trim();
  const copy = el?.cloneNode?.(true);
  if (copy) for (const br of copy.querySelectorAll?.('br') || []) br.replaceWith('\n');
  return String(copy?.textContent || el?.textContent || '').trim();
};
function visible(el) {
  if (!el?.getBoundingClientRect) return false;
  const view = el.ownerDocument?.defaultView;
  for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
    const s = view?.getComputedStyle(p);
    if (s && (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0)) return false;
  }
  const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
}
function jobIdentity(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || !(u.hostname === '58.com' || u.hostname.endsWith('.58.com'))) return '';
    // A posting number alone cannot turn a housing/product or redirect URL into a job detail.
    const m = u.pathname.match(/\/(?:tech|zhaopin|renli|caiwu|kefu|yewu|sales|shangwu|fuwuyuan|yingye|wuliucangchu|shengchankaifa|jiaoyupeixun|sheji|siji|baojie|baomu|jiudian|meirongjianshen|xiaoshou|kuaidi|zhaogong|jinrongbaoxian|yiyuanyiliao|zplvyoujiudian|zpshengchankaifa|zpjianshenmeirong|zpanmo|zpshangmao|zpwenyitiyu|zpsiji|zpwuliucangchu|hulianwangtx|ruanjianyf|npythonkf|rengongzhn|aizhinengti|dmtdmxyy|quanzhangchsh|nwebqd|chanpinjl|jishucsh|jishugl|ntongxin|shujukffx|xiangmugl|yidongyf|yunweijshzhch|zhikonganfang)\/(\d{8,})x\.shtml$/i);
    return m?.[1] || '';
  } catch { return ''; }
}
function searchScopeMatches(current, expected) {
  try {
    const actual = new URL(current), wanted = new URL(expected);
    return /^https?:$/.test(wanted.protocol) && /^[a-z0-9-]+\.58\.com$/i.test(wanted.hostname)
      && actual.origin === wanted.origin && actual.pathname.split('/')[1] === wanted.pathname.split('/')[1]
      && (!wanted.searchParams.has('fullPath') || actual.searchParams.get('fullPath') === wanted.searchParams.get('fullPath'))
      && (actual.searchParams.get('key') || '').trim() === (wanted.searchParams.get('key') || '').trim();
  } catch { return false; }
}
function pick(doc, selectors) {
  for (const s of selectors) { const el = doc.querySelector(s); if (el && text(el)) return text(el); }
  return '';
}
function readPageBlock(doc, href) {
  let u; try { u = new URL(href); } catch { return null; }
  const result = (kind, message) => ({ kind, message });
  const risk = () => result('risk', '58同城要求安全验证，已暂停并保留页面，请手动完成后继续');
  if (u.hostname === '404.58.com' || /^\/404(?:\.html|\/|$)/.test(u.pathname)) return result('failed', '58页面不存在，请重新打开58选择城市，再进入该城市的招聘列表');
  if (u.hostname === 'callback.58.com' && /antibot|verifycode/.test(u.pathname)) return risk();
  if (/captcha|antibot|verifycode/i.test(u.pathname)) return risk();
  if (u.hostname === 'passport.58.com' || /\/login\b/.test(u.pathname)) return result('login', '请先在58同城标签页登录求职账号');
  for (const frame of doc.querySelectorAll('iframe')) {
    if (visible(frame) && /antibot|verifycode|captcha/i.test(frame.getAttribute('src') || '')) return risk();
  }
  for (const el of doc.querySelectorAll(PANELS + ', .yidun_popup, .yidun_modal, #captcha, [class*="login-dialog"], [class*="loginDialog"]')) {
    if (!visible(el) || el.closest(JOB_BODY)) continue;
    const t = compact(text(el));
    if (/访问过于频繁|安全验证|人机验证|拖动.*滑块|五分钟内完成验证/.test(t)) return risk();
    if (/投递.{0,8}(?:上限|用完)|今日.{0,8}(?:投递|申请).{0,8}上限|账户.{0,8}(?:违规|冻结)|违规操作/.test(t)) return result('risk', '58同城投递受限，已暂停，请人工核对账号与平台提示');
    if (/(?:已|已经)投递过.{0,8}公司|(?:已|已经)申请过/.test(t)) return result('skip', '58提示该岗位或公司已经投递，跳过重复申请');
    if (/短信验证码|扫码登录|请先登录|登录后.{0,8}申请/.test(t)) return result('login', '58同城需要登录或短信验证，请在当前页面手动完成');
    if (/完善.{0,12}简历|简历.{0,8}不完整|先.{0,8}创建简历|填写.{0,8}简历/.test(t)) return result('resume', '58在线简历尚未完整，请在58完善后再投递');
    if (/投递失败|申请失败|简历.{0,8}(?:异常|删除)|职位.{0,8}(?:删除|下架)|网络异常/.test(t)) return result('failed', '58未确认申请成功，请核对当前页面的投递提示');
  }
  return null;
}
function readAction(doc) {
  for (const el of doc.querySelectorAll(ACTIONS)) {
    if (!visible(el) || el.closest(JOB_BODY) || el.matches('input, [type="file"]')) continue;
    const label = compact(text(el));
    if (ALREADY.includes(label)) return { kind: 'already', el };
    if (APPLY.includes(label) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') return { kind: 'ready', el };
  }
  return { kind: 'missing', el: null };
}
function successSignals(doc) {
  return [...doc.querySelectorAll(PANELS)].filter(visible).filter(el => !el.closest(JOB_BODY))
    .map(text).filter(t => /(?:申请|投递)(?:职位)?成功|简历已(?:成功)?(?:发送|投递)|职位申请已提交/.test(compact(t)));
}
function inspect(doc, href, expectedUrl) {
  const block = readPageBlock(doc, href); if (block) return { kind: block.kind, message: block.message };
  const current = jobIdentity(href), expected = jobIdentity(expectedUrl);
  if (!current || !expected || current !== expected) return { kind: 'mismatch', message: '58当前页面与目标岗位不一致，已取消投递' };
  const action = readAction(doc);
  if (action.el) {
    const target = action.el.getAttribute('href') || '';
    if (/^https?:/i.test(target)) {
      try { const h = new URL(target).hostname; if (h !== '58.com' && !h.endsWith('.58.com')) return { kind: 'external', message: '58岗位要求站外申请，已跳过' }; } catch { return { kind: 'mismatch', message: '58申请入口链接无效' }; }
    }
  }
  if (action.el) action.el.setAttribute('data-bossclaw-wuba-apply', current);
  return { kind: action.kind, jobId: current, signals: successSignals(doc) };
}
function extract(doc, href) {
  const jobId = jobIdentity(href); if (!jobId || readPageBlock(doc, href)) return null;
  const description = pick(doc, ['.des', '.job_des', '.job-description', '[itemprop="description"]']);
  if (!description) return null;
  return { platform: 'wuba', jobId, url: href,
    title: pick(doc, ['.pos_title', 'h1.job_title']),
    company: pick(doc, ['.comp_baseInfo_title a', '.comp_baseInfo_title', '.company_name a', '.job-company-name', '[itemprop="hiringOrganization"] [itemprop="name"]']),
    salary: pick(doc, ['.pos_salary', '.job_salary', '[class*="salary"]']),
    location: pick(doc, ['.pos_address', '.pos-area', '.work-address', '[itemprop="jobLocation"]']),
    address: pick(doc, ['.pos-area']).replace(/查看地图/g, '').trim(),
    companySize: pick(doc, ['.comp_baseInfo_scale']),
    description: description.slice(0, 9000) };
}
function selectedResume(doc, title) {
  const modal = doc.querySelector('#chooseResume'); if (!visible(modal)) return null;
  const name = text(modal.querySelector('.infoName'));
  const selected = modal.querySelector('input[name="resumeGroup"]:checked');
  const button = modal.querySelector('#resumeList_delivery');
  if (!name || compact(name) !== compact(title) || !selected?.value || !visible(selected.closest('.resume-item'))
    || !visible(button) || compact(text(button)) !== '立即申请' || !button.classList.contains('active')) return null;
  return { resumeId: String(selected.value), button };
}
function cardJob(card, href) {
  if (!searchCards(card.ownerDocument, href).cards.includes(card)) return null;
  const a = card.querySelector('.job_name a[href]');
  if (!a) return null;
  let url; try { url = new URL(a.getAttribute('href'), href).href; } catch { return null; }
  const jobId = jobIdentity(url);
  if (!jobId) return null;
  const name = text(a).split('|').map(s => s.trim());
  const city = pick(card.ownerDocument, ['#commonTopbar_city h1', '.city h1'])
    || pick(card.ownerDocument, ['.crumb_item h1']).replace(/(?:全职)?招聘.*$/, '').trim();
  return { platform: 'wuba', jobId, url, title: name[name.length - 1],
    company: pick(card, ['.comp_name a', '.comp_name']), salary: pick(card, ['.job_salary']),
    location: [city, name.length > 1 ? name[0] : ''].filter(Boolean).join('-'),
    description: text(card), labels: [], skills: [], welfare: [] };
}
function categoryScope(doc, href) {
  try {
    const u = new URL(href || doc.URL);
    let value = u.searchParams.get('fullPath');
    if (!value) {
      const selected = doc.querySelector('#filterJob li.select a[href]');
      const native = selected && new URL(selected.getAttribute('href'), u.href);
      if (native && native.origin === u.origin && native.pathname.split('/')[1] === u.pathname.split('/')[1]) value = native.searchParams.get('fullPath');
    }
    return /^674(?:,\d+)*$/.test(value || '') ? value : '';
  } catch { return ''; }
}
function cardMatchesCategory(card, scope) {
  if (!scope || scope === '674') return true;
  try {
    const data = JSON.parse(card.querySelector('.job_name a[href]')?.getAttribute('tracelogext') || '{}');
    const path = String(data.new_catepath || '');
    return /^674(?:,\d+)*$/.test(path) && (path === scope || path.startsWith(scope + ','));
  } catch { return false; }
}
function searchCards(doc, href) {
  // Native SSR streams cards before the trailing recommendation marker. Wait for the full DOM.
  if (doc.readyState === 'loading') return { cards: [], endReached: false, recommendationCount: 0, excludedCategoryCount: 0 };
  const root = doc.querySelector('#list_con') || doc;
  const items = [...root.querySelectorAll('.job_item')].filter(item => !item.closest('#pc_list_rec, #pc_list_rec_right'));
  // Native 58 inserts this job-less LI between matching results and fallback recommendations.
  const boundary = items.findIndex(item => !item.querySelector('.job_name a[href]')
    && /暂无(?:相关)?(?:职位|岗位)|没有找到(?:相关)?职位|暂无符合条件/.test(compact(text(item))));
  const matching = (boundary < 0 ? items : items.slice(0, boundary)).filter(item => item.querySelector('.job_name a[href]'));
  const scope = categoryScope(doc, href);
  const cards = matching.filter(card => cardMatchesCategory(card, scope));
  const nativeEmpty = !matching.length && [...doc.querySelectorAll('.noData')].some(el => /暂时没有符合该条件的职位|暂无符合条件|暂无相关职位/.test(compact(text(el))));
  const outside = doc.querySelectorAll('#pc_list_rec .job_item, #pc_list_rec_right .job_item').length;
  return { cards, endReached: boundary >= 0 || nativeEmpty, excludedCategoryCount: matching.length - cards.length,
    recommendationCount: outside + (boundary < 0 ? 0 : items.slice(boundary + 1).filter(item => item.querySelector('.job_name a[href]')).length) };
}
function listState(doc, href) {
  const state = searchCards(doc, href);
  return { endReached: state.endReached, resultCount: state.cards.length, recommendationCount: state.recommendationCount, excludedCategoryCount: state.excludedCategoryCount };
}
function collect(doc, href) {
  const seen = new Set();
  return searchCards(doc, href).cards.map(card => cardJob(card, href)).filter(job => {
    if (!job || seen.has(job.jobId)) return false; seen.add(job.jobId); return true;
  });
}
module.exports = { APPLY, ALREADY, JOB_BODY, visible, jobIdentity, searchScopeMatches, readPageBlock, readAction, successSignals, inspect, extract, selectedResume, listState, cardJob, collect };
