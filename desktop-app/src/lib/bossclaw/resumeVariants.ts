import type { ImageResume, JobMeta, Profile } from './types';
import type { ResumeWritingPreferences } from './resumeWriting';
import { buildLocalProfile } from './profile';
import { originalResumeProjects } from './resumeFacts';

export type ResumeVariantKind = 'python' | 'ai_application' | 'general';
export interface ResumeVariant {
  id: string;
  name: string;
  kind: ResumeVariantKind;
  text: string;
  fileName: string;
  updatedAt: number;
}

/** Immutable generation input: history/export must not read a later edited variant. */
export interface ResumeSourceSnapshot {
  id?: string;
  name: string;
  text: string;
  profile: Profile | null;
  writingPreferences: ResumeWritingPreferences;
}

export interface ResumeVariantData {
  resumeText: string;
  profile: Profile | null;
  resumeWritingPreferences: ResumeWritingPreferences;
  resumeVariants?: ResumeVariant[];
  defaultResumeVariantId?: string;
  autoResumeRouting?: boolean;
}

const sectionHeading = /^(教育背景|个人荣誉|个人简介|自我评价|专业技能|工作经历|实习经历|项目经历|项目经验|项目实践|其他技术实践)$/;
function section(text: string, names: string[]): string[] {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const start = lines.findIndex(line => names.includes(line));
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && !sectionHeading.test(lines[end])) end++;
  return lines.slice(start + 1, end);
}

/** Applicant constraints stay shared; facts and emphasis come only from this version. */
export function profileForResume(variant: ResumeVariant, base: Profile | null): Profile {
  const local = buildLocalProfile(variant.text);
  const projects = originalResumeProjects(variant.text, { preserveProjectText: true });
  const experience = section(variant.text, ['工作经历', '实习经历']);
  const summary = section(variant.text, ['个人简介', '自我评价']).join('\n');
  const p: Profile = JSON.parse(JSON.stringify(base || local));
  p.facts = {
    education: section(variant.text, ['教育背景']).length ? [section(variant.text, ['教育背景']).join('\n')] : local.facts.education,
    experiences: experience.length ? [experience.join('\n')] : local.facts.experiences,
    projects: projects.length ? projects.map(b => [b.heading, b.meta, ...b.bullets.map(l => l.text)].filter(Boolean).join('\n')) : local.facts.projects,
    skills: section(variant.text, ['专业技能']).length ? section(variant.text, ['专业技能']) : local.facts.skills,
    certificates: section(variant.text, ['个人荣誉']).length ? section(variant.text, ['个人荣誉']) : local.facts.certificates,
    capabilities: local.facts.capabilities,
  };
  p.summary = summary || local.summary;
  if (variant.kind !== 'general') {
    const direction = variant.kind === 'ai_application' ? 'AI 应用开发' : 'Python 开发与自动化';
    p.primaryDirections = [{ name: direction, confidence: 1, evidence: [variant.name] }, ...p.primaryDirections.filter(d => d.name !== direction)];
  }
  return p;
}

export function inferResumeKind(job: JobMeta): Exclude<ResumeVariantKind, 'general'> | undefined {
  const title = String(job.title || '');
  if (/vibe\s*coding|ai[\s-]*(?:应用|开发|编程|工程|产品)|人工智能.*(?:应用|开发)|大模型|智能体|\bagent\b|\brag\b|aigc/i.test(title)) return 'ai_application';
  if (/python|自动化|计算机视觉|图像|目标检测|数据处理|爬虫|测试|后端|backend/i.test(title)) return 'python';
  // A framework/tool in an optional qualification must not change a Python/general role's route.
  const responsibilities = String(job.description || '').split(/加分(?:项)?|优先条件|优先考虑|加分条件/)[0];
  if (/vibe\s*coding|(?:ai|大模型|智能体).{0,10}(?:应用开发|产品开发|原型开发)|开发.{0,12}(?:ai应用|大模型应用|智能体)/i.test(responsibilities)) return 'ai_application';
  return undefined;
}

export function resolveResumeForJob(data: ResumeVariantData, job: JobMeta = {}, overrideId?: string) {
  const variants = (Array.isArray(data.resumeVariants) ? data.resumeVariants : []).filter(v => v && typeof v.id === 'string' && typeof v.text === 'string' && v.text.trim());
  const manualId = overrideId || job.resumeVariantId;
  const manual = variants.find(v => v.id === manualId);
  const fallback = variants.find(v => v.id === data.defaultResumeVariantId) || variants[0];
  const kind = data.autoResumeRouting !== false ? inferResumeKind(job) : undefined;
  const automatic = kind ? variants.find(v => v.kind === kind) : undefined;
  const chosen = manual || automatic || fallback;
  const reason = manual ? '手动指定' : manualId ? '指定版本已移除，使用默认版本' : automatic ? '按岗位方向自动选择' : '使用默认版本';
  // Missing explicit overrides use the default, never a different automatic match.
  const variant = manualId && !manual ? fallback : chosen;
  const source: ResumeSourceSnapshot = {
    id: variant?.id,
    name: variant?.name || '原简历',
    text: variant?.text || data.resumeText,
    profile: variant ? profileForResume(variant, data.profile) : data.profile,
    writingPreferences: { ...data.resumeWritingPreferences },
  };
  return { source: JSON.parse(JSON.stringify(source)) as ResumeSourceSnapshot, reason };
}

/** Bound versions never fall back to an unbound/other version's attachment. */
export function selectResumeImages(images: ImageResume[], source: Pick<ResumeSourceSnapshot, 'id'>): ImageResume[] {
  return images.filter(image => source.id ? image.resumeVariantId === source.id : !image.resumeVariantId);
}
