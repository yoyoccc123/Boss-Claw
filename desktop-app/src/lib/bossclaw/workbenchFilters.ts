import type { JobMeta, PendingItem } from './types';
import { assessJobAddress } from './addressRisk';
import { parseSalaryRange } from './jobMatch';
import { detectWorkSchedule } from './workSchedule';
import { companySizeOfJob } from './companySize';

export interface WorkbenchFilters {
  hideResidential: boolean;
  salaryUnit: 'monthly' | 'daily';
  salaryMin: number | null;
  salaryMax: number | null;
  keepUnknownSalary: boolean;
  companyMin: number | null;
  companyMax: number | null;
  keepUnknownCompanySize: boolean;
}

export const DEFAULT_WORKBENCH_FILTERS: WorkbenchFilters = {
  hideResidential: false, salaryUnit: 'monthly', salaryMin: null, salaryMax: null, keepUnknownSalary: true,
  companyMin: null, companyMax: null, keepUnknownCompanySize: true,
};

export function normalizeWorkbenchFilters(value?: Partial<WorkbenchFilters>): WorkbenchFilters {
  const amount = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(n, 1e9) : null;
  return { hideResidential: value?.hideResidential === true, salaryUnit: value?.salaryUnit === 'daily' ? 'daily' : 'monthly',
    salaryMin: amount(value?.salaryMin), salaryMax: amount(value?.salaryMax), keepUnknownSalary: value?.keepUnknownSalary !== false,
    companyMin: amount(value?.companyMin), companyMax: amount(value?.companyMax), keepUnknownCompanySize: value?.keepUnknownCompanySize !== false };
}

export function invalidSalaryFilter(filters: WorkbenchFilters): boolean {
  return filters.salaryMin != null && filters.salaryMax != null && filters.salaryMax < filters.salaryMin;
}

/** 按公开薪资下限筛选。月薪、日薪、时薪采用已有工作制度折算，13薪等奖金不计入。 */
export function matchesWorkbenchSalary(job: JobMeta, input?: Partial<WorkbenchFilters>): boolean {
  const filters = normalizeWorkbenchFilters(input);
  if (invalidSalaryFilter(filters)) return false;
  if (filters.salaryMin == null && filters.salaryMax == null && filters.keepUnknownSalary) return true;
  const schedule = detectWorkSchedule(job);
  const range = parseSalaryRange(job.salary, schedule.monthlyWorkDays);
  if (!range.valid) return filters.keepUnknownSalary;
  const low = range.low * 1000 / (filters.salaryUnit === 'daily' ? schedule.monthlyWorkDays : 1);
  return (filters.salaryMin == null || low + 1e-6 >= filters.salaryMin) &&
    (filters.salaryMax == null || low - 1e-6 <= filters.salaryMax);
}

export function isWorkbenchJobIncluded(job: JobMeta, input?: Partial<WorkbenchFilters>): boolean {
  const filters = normalizeWorkbenchFilters(input);
  const size = companySizeOfJob(job);
  const valid = !(filters.companyMin != null && filters.companyMax != null && filters.companyMax < filters.companyMin);
  const companyMatches = size ? (filters.companyMin == null || size.low >= filters.companyMin) &&
    (filters.companyMax == null || size.low <= filters.companyMax) : filters.keepUnknownCompanySize;
  return valid && companyMatches && !(filters.hideResidential && assessJobAddress(job).suspicious) && matchesWorkbenchSalary(job, filters);
}

export function filterWorkbenchJobs(items: PendingItem[], filters?: Partial<WorkbenchFilters>): PendingItem[] {
  return items.filter((item) => isWorkbenchJobIncluded(item.job, filters));
}
