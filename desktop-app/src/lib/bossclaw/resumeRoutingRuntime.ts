import { useDataStore } from '@/store/useDataStore';
import { analyzeJob } from './matching';
import { resolveResumeForJob } from './resumeVariants';
import type { AppConfig, JobMeta } from './types';

export function storedResumeForJob(job: JobMeta, overrideId?: string) {
  return resolveResumeForJob(useDataStore.getState(), job, overrideId);
}

export async function analyzeJobWithResume(job: JobMeta, config: AppConfig, prompt?: string) {
  const { source } = storedResumeForJob(job);
  const analysis = await analyzeJob(job, source.profile, source.text, config, config.model, prompt);
  return { ...analysis, resumeVariantId: source.id, resumeVariantName: source.name };
}
