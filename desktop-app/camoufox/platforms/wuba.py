"""58求职端：城市/关键词采集、平台在线简历申请。DOM规则与webview共用。"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse, quote
from .base import CollectorBase
from .common import human_sleep
from .wuba_filters import filter_params, category_option

_HERE = Path(__file__).resolve().parent
_SITE = json.loads((_HERE / 'wuba-site.json').read_text(encoding='utf-8'))
_DOM = _HERE / 'wuba-dom.cjs'
if not _DOM.is_file():
    _DOM = _HERE.parents[1] / 'electron' / 'preload' / 'wuba.cjs'
_LIB = '(function(){const module={exports:{}};' + _DOM.read_text(encoding='utf-8') + ';return module.exports;})()'


def build_search_url(query='', city='', salary='', page=1, criteria=None):
    types = (criteria or {}).get('employmentTypes') or (criteria or {}).get('employment_types') or []
    if types and all(t == '兼职' for t in types):
        raise ValueError('58兼职是独立页面，当前接入全职招聘列表，请调整求职类型')
    city = str(city or '').strip().removesuffix('市')
    if city in ('', '全国', '不限', '全部', '不限制'):
        raise ValueError('58招聘需要选择具体城市，请在设置的目标城市中添加城市后再采集')
    slug = _SITE['cities'].get(city)
    if not slug:
        raise ValueError(f'58同城暂未登记城市“{city}”，请选择已支持城市')
    number = max(1, int(page or 1))
    filters = filter_params({**(criteria or {}), 'salary': salary or (criteria or {}).get('salary')})
    path = '_'.join(f'pve_{key}_{value}' for key, value in filters.items() if key != 'postdate')
    category = category_option(criteria)
    url = f'https://{slug}.58.com/{category["value"]}/' + (f'pn{number}/' if number > 1 else '')
    if path:
        url += path + '/'
    params = {'fullPath': category['fullPath']}
    if str(query or '').strip():
        params['key'] = str(query).strip()
        params['final'] = '1'  # Native filter links preserve filters/page across keyword classification.
    if filters.get('postdate'):
        params['postdate'] = filters['postdate']
    return url + ('?' + urlencode(params, quote_via=quote) if params else '')


def _evaluate(page, body, arg=None):
    return page.evaluate('(arg)=>{const W=' + _LIB + ';' + body + '}', arg)


class WubaCollector(CollectorBase):
    platform = 'wuba'
    label = '58同城'
    home_url = 'https://www.58.com/changecity.html?catepath=quanzhizhaopin'
    login_url = 'https://passport.58.com/login/'
    login_host = '58.com'
    capture_wait_attempts = 0  # SSR list; no speculative search API polling.
    supports_external_skip = True

    def build_search_url(self, query, city, salary, page=1, criteria=None):
        self._expected_search_url = build_search_url(query, city, salary, page, criteria)
        return self._expected_search_url

    def parse_api_payload(self, root):
        return []

    def dom_cards_js(self):
        return '()=>{const W=' + _LIB + ';return W.collect(document,location.href);}'

    def format_jobs(self, raw, keyword='', page=0):
        return [{**job, 'platform': 'wuba', 'keyword': keyword} for job in raw if job.get('jobId') and job.get('title')]

    def empty_list_hit(self, page):
        state = _evaluate(page, 'return W.listState(document);')
        return bool(state.get('endReached') and not state.get('resultCount'))

    def search_page_exhausted(self, page):
        return bool(_evaluate(page, 'return W.listState(document).endReached;'))

    def search_page_ready(self, page):
        return bool(_evaluate(page, 'if(!W.searchScopeMatches(location.href,arg))return false;const s=W.listState(document);return s.endReached||s.resultCount>0||s.excludedCategoryCount>0;', self._expected_search_url))

    def is_logged_out(self, page):
        block = _evaluate(page, 'return W.readPageBlock(document,location.href);')
        return bool(block and block.get('kind') == 'login')

    def deliver(self, job, greeting, *args, **kwargs):
        self._expected_url = str(job.get('url') or '')
        target = urlparse(self._expected_url)
        if target.scheme not in ('http', 'https') or not (target.hostname == '58.com' or str(target.hostname).endswith('.58.com')) \
                or not re.search(r'/\d{8,}x\.shtml$', target.path):
            return {'ok': False, 'sent': False, 'code': 400, 'message': '58岗位详情链接不完整，未投递'}
        return super().deliver(job, greeting, *args, **kwargs)

    def find_action_button(self, page):
        state = _evaluate(page, 'return W.inspect(document,location.href,arg);', self._expected_url)
        kind = state.get('kind', 'missing')
        return kind, page.locator('[data-bossclaw-wuba-apply]').first if kind == 'ready' else None

    def handle_action_state(self, state):
        codes = {'risk': 35, 'login': 31, 'already': 409, 'skip': 409, 'resume': 501, 'mismatch': 400, 'failed': 501}
        if state in codes:
            return {'ok': False, 'sent': False, 'code': codes[state], 'message': f'58申请未提交（{state}），请核对当前岗位及在线简历'}
        return super().handle_action_state(state)

    def before_action(self, page):
        return _evaluate(page, "return {title:document.querySelector('.pos_title')?.textContent?.trim(),signals:W.successSignals(document)};")

    def finish_action(self, page, greeting, before=None):
        before = before or {}
        submitted = False
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            result = _evaluate(page, '''
                const state=W.inspect(document,location.href,arg.url);
                if(W.jobIdentity(location.href)===W.jobIdentity(arg.url) && (state.kind==='already'||W.successSignals(document).some(s=>!arg.signals.includes(s))))return {kind:'success'};
                if(!['ready','already'].includes(state.kind))return state;
                const selected=W.selectedResume(document,arg.title);
                return selected?{kind:'resume_ready',resumeId:selected.resumeId}:state;
            ''', {'url': self._expected_url, 'title': before.get('title'), 'signals': before.get('signals', [])})
            kind = result.get('kind')
            if kind == 'success':
                return {'ok': True, 'sent': True, 'code': 0, 'method': 'wuba-resume'}
            if kind not in ('ready', 'resume_ready'):
                return {'ok': False, 'sent': False, 'code': 35 if kind == 'risk' else 31 if kind == 'login' else 501,
                        'message': result.get('message') or '58投递未确认，请核对页面'}
            if kind == 'resume_ready' and not submitted:
                unchanged = _evaluate(page, 'return W.selectedResume(document,arg.title)?.resumeId===arg.id && W.jobIdentity(location.href)===W.jobIdentity(arg.url);',
                                      {'title': before.get('title'), 'id': result['resumeId'], 'url': self._expected_url})
                if not unchanged:
                    break
                submitted = True
                page.locator('#chooseResume #resumeList_delivery').click(timeout=5000)
            human_sleep(0.4, 0.2, 0.3)
        return {'ok': False, 'sent': False, 'code': 501, 'message': '58申请结果未确认，未计为成功，请人工核对'}

    def confirm_sent(self, page):
        return False  # finish_action performs correlated confirmation; never guess from an old success panel.


_COLLECTOR = WubaCollector()
