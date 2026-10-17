import data from '../../../camoufox/platforms/wuba-filters.json';
import categories from '../../../electron/preload/wuba-categories.json';
import type { WubaSearchFilters } from './types';

export const WUBA_NATIVE_FILTERS = data;
export const WUBA_CATEGORIES = categories;
export type WubaCategoryNode = { value: string; label: string; children?: WubaCategoryNode[] };
// Keep the stored native listname stable; the UI hierarchy derives from the verified numeric paths.
const categoryNodes = new Map(categories.options.map(o => [o.fullPath, { value: o.value, label: o.label } as WubaCategoryNode]));
export const WUBA_CATEGORY_TREE: WubaCategoryNode[] = [];
for (const option of categories.options) {
  const node = categoryNodes.get(option.fullPath)!;
  const parentPath = option.fullPath.split(',').slice(0, -1).join(',');
  if (!parentPath || parentPath === '674') WUBA_CATEGORY_TREE.push(node);
  else {
    const parent = categoryNodes.get(parentPath);
    if (parent) (parent.children ||= []).push(node);
  }
}
export function wubaCategoryPath(value?: string): string[] {
  const option = categories.options.find(o => o.value === (value || categories.default));
  if (!option) return [];
  if (option.fullPath === '674') return [option.value];
  return categories.options.filter(o => o.fullPath !== '674' && (option.fullPath === o.fullPath || option.fullPath.startsWith(o.fullPath + ',')))
    .sort((a, b) => a.fullPath.length - b.fullPath.length).map(o => o.value);
}
export function wubaCategory(filters?: WubaSearchFilters) {
  const value = isWubaCategoryAutomatic(filters) ? categories.default : filters!.category;
  const option = categories.options.find(o => o.value === value);
  if (!option) throw new Error('58职位类别无效，请在招聘平台设置中重新选择');
  return option;
}

export function isWubaCategoryAutomatic(filters?: WubaSearchFilters): boolean {
  return !filters?.category || filters.category === 'auto';
}

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
type Category = typeof categories.options[number];
const under = (child: Category, parent: Category) => child.fullPath === parent.fullPath || child.fullPath.startsWith(parent.fullPath + ',');
// Only literal public occupation names/aliases are matched. Ambiguous branches use their common parent.
function categoryFromText(text: string): Category | undefined {
  const source = normalized(text);
  const aliases = categories.autoAliases as Record<string, string[]>;
  const matches: { start: number; end: number; option: Category }[] = [];
  for (const option of categories.options.filter(o => o.fullPath !== '674')) {
    for (const name of [option.label, ...(aliases[option.value] || [])]) {
      const term = normalized(name);
      if (!term) continue;
      let start = source.indexOf(term);
      while (start >= 0) {
        const end = start + term.length;
        // Do not mistake JavaScript for Java, Django for Go, or mail for AI.
        if (!(/[a-z0-9]/.test(term[0]) && /[a-z0-9]/.test(source[start - 1] || '')) &&
            !(/[a-z0-9]/.test(term[term.length - 1]) && /[a-z0-9]/.test(source[end] || ''))) matches.push({ start, end, option });
        start = source.indexOf(term, start + 1);
      }
    }
  }
  const matched = [...new Map(matches.filter(m => !matches.some(other =>
    other.start <= m.start && other.end >= m.end && other.end - other.start > m.end - m.start
  )).map(m => [m.option.value, m.option])).values()];
  const candidates = matched.filter(o => !matched.some(other => other.value !== o.value && under(other, o)));
  if (!candidates.length) return undefined;
  return categories.options.filter(o => o.fullPath !== '674' && candidates.every(c => under(c, o)))
    .sort((a, b) => b.fullPath.split(',').length - a.fullPath.split(',').length)[0];
}

/** The configured direction takes precedence; a keyword may narrow its branch, never switch it. */
export function resolveWubaCategory(filters?: WubaSearchFilters, directionName = '', keyword = ''): Category {
  if (!isWubaCategoryAutomatic(filters)) return wubaCategory(filters);
  const direction = categoryFromText(directionName);
  const query = categoryFromText(keyword);
  return (direction && query && under(query, direction) ? query : direction || query) || wubaCategory();
}

export function wubaCategoryLabel(value: string): string {
  return wubaCategoryPath(value).map(v => categories.options.find(o => o.value === v)!.label.trim()).join(' → ');
}
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
