import data from '../../../camoufox/platforms/wuba-filters.json';
import type { WubaSearchFilters } from './types';

export const WUBA_NATIVE_FILTERS = data;
type Field = keyof typeof data.fields;
type Criteria = { salary?: string; degrees?: string[]; experiences?: string[]; wubaSearchFilters?: WubaSearchFilters };
const noFilter = (v: string) => !v || ['不限', '全部', '不限制', '所有', '不限学历'].includes(v);
const one = (values?: string[]) => values?.length === 1 && !noFilter(values[0]) ? values[0] : '';
const salaryAliases: Record<string, string> = {
  '1K以下': '1000元以下', '1-2K': '1000-2000元', '2-3K': '2000-3000元', '3-5K': '3000-5000元',
  '5-8K': '5000-8000元', '8-12K': '8000-12000元', '12-20K': '12000-20000元', '20-25K': '20000-25000元', '25K以上': '25000元以上',
};
export function wubaFilterParams(criteria: Criteria = {}, now = Date.now()): Record<string, string> {
  const overrides = criteria.wubaSearchFilters || {};
  const fallback: Record<Field, string> = {
    salary: salaryAliases[String(criteria.salary || '').trim().toUpperCase()] || String(criteria.salary || '').trim(),
    degree: one(criteria.degrees), experience: one(criteria.experiences).replace(/^1年以内$/, '1年以下'), industry: '',
  };
  const params: Record<string, string> = {};
  for (const field of Object.keys(data.fields) as Field[]) {
    const explicit = String(overrides[field] || '').trim();
    const value = explicit || fallback[field];
    if (noFilter(value)) continue;
    const option = data.fields[field].options.find(o => o.label === value);
    if (option) params[data.fields[field].parameter] = option.value;
    else if (explicit) throw new Error(`58${data.fields[field].label}选项已变化，请在招聘平台设置中重新选择`);
    // Native controls are single-select. Never narrow a shared multi-select or invent a cross-band code.
  }
  const days = Number(overrides.publishedWithinDays || 0);
  if (days !== 0) {
    if (!data.publishedWithinDays.some(o => o.days === days)) throw new Error('58发布时间选项无效，请重新选择');
    const day = Math.floor((now + 8 * 3600000) / 86400000);
    const stamp = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    params.postdate = `${stamp(day + 1 - days)}_${stamp(day + 1)}`;
  }
  return params;
}
