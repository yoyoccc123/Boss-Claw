"""Verified native 58 single-select filters; public option codes are shared with TypeScript."""
import json
import time
import re
import unicodedata
from pathlib import Path
from datetime import datetime, timezone

DATA = json.loads((Path(__file__).parent / 'wuba-filters.json').read_text(encoding='utf-8'))
_CATEGORIES_FILE = Path(__file__).parent / 'wuba-categories.json'
if not _CATEGORIES_FILE.is_file():
    _CATEGORIES_FILE = Path(__file__).resolve().parents[2] / 'electron/preload/wuba-categories.json'
CATEGORIES = json.loads(_CATEGORIES_FILE.read_text(encoding='utf-8'))


def _normalized(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(text or '')).lower()).strip()


def _under(child, parent):
    return child['fullPath'] == parent['fullPath'] or child['fullPath'].startswith(parent['fullPath'] + ',')


def _category_from_text(text):
    source, matches = _normalized(text), []
    options = [o for o in CATEGORIES['options'] if o['fullPath'] != '674']
    for option in options:
        for name in [option['label'], *CATEGORIES['autoAliases'].get(option['value'], [])]:
            term = _normalized(name)
            if not term:
                continue
            start = source.find(term)
            while start >= 0:
                end = start + len(term)
                before = source[start - 1:start] if start else ''
                after = source[end:end + 1]
                if not (re.fullmatch('[a-z0-9]', term[0]) and re.fullmatch('[a-z0-9]', before)) and not (re.fullmatch('[a-z0-9]', term[-1]) and re.fullmatch('[a-z0-9]', after)):
                    matches.append((start, end, option))
                start = source.find(term, start + 1)
    matched = {o['value']: o for start, end, o in matches if not any(a <= start and b >= end and b - a > end - start for a, b, _ in matches)}
    candidates = [o for o in matched.values() if not any(other['value'] != o['value'] and _under(other, o) for other in matched.values())]
    if not candidates:
        return None
    parents = [o for o in options if all(_under(child, o) for child in candidates)]
    return max(parents, key=lambda o: len(o['fullPath'].split(',')), default=None)


def category_option(criteria=None, keyword='', direction_name=''):
    raw = criteria or {}
    filters = raw.get('wubaSearchFilters') or raw.get('wuba_search_filters') or {}
    value = filters.get('category') or CATEGORIES['default']
    if not filters.get('category') or value == 'auto':
        direction, query = _category_from_text(direction_name), _category_from_text(keyword)
        resolved = query if direction and query and _under(query, direction) else direction or query
        value = resolved['value'] if resolved else CATEGORIES['default']
    option = next((o for o in CATEGORIES['options'] if o['value'] == value), None)
    if not option:
        raise ValueError('58职位类别无效，请重新选择')
    return option


NO_FILTER = ('', '不限', '全部', '不限制', '所有', '不限学历')
SALARY_ALIASES = {
    '1K以下': '1000元以下', '1-2K': '1000-2000元', '2-3K': '2000-3000元', '3-5K': '3000-5000元',
    '5-8K': '5000-8000元', '8-12K': '8000-12000元', '12-20K': '12000-20000元', '20-25K': '20000-25000元', '25K以上': '25000元以上',
}


def filter_params(criteria=None, now=None):
    raw = criteria or {}
    overrides = raw.get('wubaSearchFilters') or raw.get('wuba_search_filters') or {}
    def one(values):
        values = values if isinstance(values, list) else [values] if values else []
        return str(values[0]).strip() if len(values) == 1 and str(values[0]).strip() not in NO_FILTER else ''
    salary = str(raw.get('salary') or '').strip()
    fallback = {'salary': SALARY_ALIASES.get(salary.upper(), salary), 'degree': one(raw.get('degrees') or raw.get('degree')),
                'experience': one(raw.get('experiences') or raw.get('experience')), 'industry': ''}
    if fallback['experience'] == '1年以内':
        fallback['experience'] = '1年以下'
    params = {}
    for field, spec in DATA['fields'].items():
        explicit = str(overrides.get(field) or '').strip()
        value = explicit or fallback[field]
        if value in NO_FILTER:
            continue
        option = next((o for o in spec['options'] if o['label'] == value), None)
        if option:
            params[spec['parameter']] = option['value']
        elif explicit:
            raise ValueError(f"58{spec['label']}选项已变化，请重新选择")
    days = float(overrides.get('publishedWithinDays') or 0)
    if days:
        if days not in [o['days'] for o in DATA['publishedWithinDays']]:
            raise ValueError('58发布时间选项无效，请重新选择')
        days = int(days)
        day = int(((time.time() if now is None else now) + 8 * 3600) // 86400)
        stamp = lambda d: datetime.fromtimestamp(d * 86400, timezone.utc).strftime('%Y%m%d')
        params['postdate'] = stamp(day + 1 - days) + '_' + stamp(day + 1)
    return params
