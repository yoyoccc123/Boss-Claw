"""Verified native 58 single-select filters; public option codes are shared with TypeScript."""
import json
import time
from pathlib import Path
from datetime import datetime, timezone

DATA = json.loads((Path(__file__).parent / 'wuba-filters.json').read_text(encoding='utf-8'))
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
