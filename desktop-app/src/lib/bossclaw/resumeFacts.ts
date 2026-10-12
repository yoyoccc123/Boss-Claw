import type { TailorDocLine, TailorResumeDoc } from './jobAssistant';
import type { ResumeWritingPreferences } from './resumeWriting';
import { resumeDisplayText } from './resumeWriting';

export const factKey = (text: string) => String(text || '').replace(/\s+/g, '').toLowerCase();

/** Quotes must come from applicant material, never a JD or generated document. */
export function hasFactQuote(quote: unknown, facts: string): boolean {
  return typeof quote === 'string' && factKey(quote).length >= 4 && factKey(facts).includes(factKey(quote));
}

function originalSource(source: string, facts: string): boolean {
  if (hasFactQuote(source, facts)) return true;
  const parts = source.split(/[。；;\n]/).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 && parts.every(part => hasFactQuote(part, facts));
}

const LEVELS: Array<[RegExp, number]> = [[/精通/g, 5], [/熟练/g, 4], [/熟悉|掌握|擅长/g, 3], [/了解|接触/g, 1]];
function level(text: string): number {
  return Math.max(0, ...LEVELS.filter(([re]) => { re.lastIndex = 0; return re.test(text); }).map(([, rank]) => rank));
}

const TECH = /Python|JavaScript|TypeScript|Java(?!Script)|C\+\+|SQL(?:ite)?|MySQL|PyTorch|TensorFlow|Flask|FastAPI|Django|React|Vue\d*|LangChain|RAG|Embedding|OpenCV|YOLO\w*|Git(?:Hub)?|Gitee/gi;
const qualifiedParts = (text: string) => [...text.matchAll(/(精通|熟练|熟悉|掌握|擅长|了解|接触)([^。；;，,\n]*?)(?=精通|熟练|熟悉|掌握|擅长|了解|接触|[。；;，,\n]|$)/g)];
const API_ACTION = /(?:API|接口)[^。；;，,\n]{0,4}(?:设计|开发|实现)|(?:设计|开发|实现)[^。；;，,\n]{0,8}(?:API|接口)/i;

/** Known responsibility/proficiency expansions require corresponding original evidence. */
export function unsupportedClaim(text: string, source: string): boolean {
  if (level(text) > level(source)) return true;
  // A strong qualifier for Python cannot be borrowed for SQL in the same quote.
  const sourceParts = qualifiedParts(source);
  for (const part of qualifiedParts(text)) {
    for (const subject of part[2].match(TECH) || []) {
      const rank = Math.max(0, ...sourceParts.filter(p => (p[2].match(TECH) || []).some(s => factKey(s) === factKey(subject))).map(p => level(p[1])));
      if (level(part[1]) > rank) return true;
    }
  }
  if (API_ACTION.test(text) && !API_ACTION.test(source)) return true;
  const claims: Array<[RegExp, RegExp]> = [
    [/独立负责|主导/, /独立负责|主导/],
    [/负责/, /负责/],
    [/(?:实现|开发)[^。；;，,\n]{0,12}(?:接口|后端|模块)|后端[^。；;，,\n]{0,8}开发/, /(?:实现|开发)[^。；;，,\n]{0,12}(?:接口|后端|模块)|后端[^。；;，,\n]{0,8}开发/],
    [/(?:数据库|表结构|数据表).{0,5}设计|设计.{0,5}(?:数据库|表结构|数据表)/, /(?:数据库|表结构|数据表).{0,5}设计|设计.{0,5}(?:数据库|表结构|数据表)/],
    [/提示词(?:工程|模板|设计)/, /提示词(?:工程|模板|设计)/],
    [/批量数据处理/, /批量数据处理/],
    [/算法(?:研发|优化)|研发.{0,8}算法/, /算法(?:研发|优化)|研发.{0,8}算法/],
  ];
  return claims.some(([claim, proof]) => claim.test(text) && !proof.test(source));
}

const NATURE = /课程设计|竞赛项目|团队项目|个人技术实践|开源二次开发|开源复现|个人原型|原型实践|项目实践/;
function projectAnchors(facts: string) {
  const lines = facts.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const anchors: Array<{ heading: string; meta: string; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    // Plain-text project headings followed by a short date/nature/stack line.
    if (!NATURE.test(lines[i]) || lines[i].length > 100 || /[。；;]/.test(lines[i])) continue;
    const inline = lines[i].split(/[|｜]/).map(part => part.trim());
    const heading = inline.find(part => /[\u4e00-\u9fff]/.test(part) && !NATURE.test(part) && !/\d{4}|[\/：:]/.test(part));
    const before = lines[i - 1];
    const title = (before && before.length < 80 && !/[。；;：:]/.test(before) && !/^(?:个人简介|专业技能|项目经历|教育背景|个人荣誉)$/.test(before) ? before : '') || heading || '';
    if (!title || /^(?:个人简介|专业技能|项目经历|教育背景|个人荣誉)$/.test(title)) continue;
    anchors.push({ heading: title, meta: lines[i], text: lines.slice(i + 1).join('\n') });
  }
  // Limit every anchor to its own project, avoiding neighbouring project labels.
  anchors.forEach((anchor, i) => {
    const next = anchors[i + 1];
    if (next) { const end = anchor.text.indexOf(next.heading); if (end >= 0) anchor.text = anchor.text.slice(0, end); }
  });
  return anchors;
}

/** Keep applicant project wording verbatim; only explicitly requested label hiding applies. */
export function originalResumeProjects(facts: string, preferences: ResumeWritingPreferences = {}): TailorResumeDoc['projects'] {
  const lines = facts.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = lines.findIndex(line => /^(?:项目经历|项目经验|项目实践)$/.test(line));
  const sectionEnd = /^(?:其他技术实践|教育背景|教育经历|个人荣誉|荣誉证书|工作经历|实习经历|专业技能|个人简介|自我评价|经历补充|【.*】)$/;
  const end = start >= 0 ? lines.findIndex((line, index) => index > start && sectionEnd.test(line)) : -1;
  const section = start >= 0 ? lines.slice(start + 1, end >= 0 ? end : lines.length).join('\n') : facts;
  return projectAnchors(section).map(anchor => ({
    heading: resumeDisplayText(anchor.heading, preferences),
    meta: resumeDisplayText(anchor.meta, preferences),
    bullets: anchor.text.split('\n').map(line => line.trim()).filter(Boolean).map(source => ({ text: resumeDisplayText(source, preferences), source })),
  }));
}

export function enforceResumeFacts(doc: TailorResumeDoc, facts: string, preferences: ResumeWritingPreferences = {}): { doc: TailorResumeDoc; corrections: string[] } {
  const corrections: string[] = [];
  const anchors = projectAnchors(facts);
  const preferred = (text: string) => resumeDisplayText(preferences.conciseRagLabel ? text.replace(/RAG\s*场\s*景\s*检索/gi, 'RAG') : text, preferences);
  const excluded = (text: string) => (preferences.omitCourseList && /相关课程|学习过.*(?:深度学习|计算机网络|数据结构)|(?:主修|核心|相关)课程/.test(text))
    || (preferences.omitPatentPreparation && /专利.*(?:评估材料|材料准备)|材料实践.*专利/.test(text));
  const guard = (line: TailorDocLine, module: string): TailorDocLine | null => {
    if (!line.text || excluded(line.text)) return null;
    if (!line.source || !originalSource(line.source, facts)) {
      corrections.push(`${module}缺少可定位原文，已移除未证实表述`);
      return null;
    }
    if (unsupportedClaim(line.text, line.source)) {
      corrections.push(`${module}已恢复原文职责或能力水平`);
      const prefix = module === '技能' ? line.text.match(/^[^：:]{1,12}[：:]/)?.[0] || '' : '';
      if (excluded(line.source)) return null;
      return { text: preferred(prefix && !/[:：]/.test(line.source) ? prefix + line.source : line.source), source: line.source };
    }
    return { ...line, text: preferred(line.text) };
  };
  const blocks = (items: TailorResumeDoc['projects'], module: string) => items.map(block => {
    const source = block.bullets.map(line => line.source).join('\n');
    const matching = module === '项目' ? anchors.find(anchor => block.bullets.some(line => line.source.split(/[。；;\n]/).some(quote => hasFactQuote(quote, anchor.text)))) : undefined;
    const base = block.heading.split(/[|｜]/)[0].trim() || matching?.heading || '';
    const rawHeading = block.heading.split(/[|｜]/)[0].trim() ? block.heading : base;
    const heading = unsupportedClaim(rawHeading.slice(base.length), source) ? base : rawHeading;
    const nature = matching?.meta.match(NATURE)?.[0];
    if (!block.heading.split(/[|｜]/)[0].trim() && base) corrections.push('已从对应原始项目恢复缺失标题');
    return {
      ...block,
      heading: preferred(heading + (nature && !`${heading} ${block.meta}`.includes(nature) ? ` | ${nature}` : '')),
      meta: preferred(block.meta || matching?.meta || ''),
      bullets: block.bullets.map(line => guard(line, module)).filter((line): line is TailorDocLine => !!line),
    };
  });
  let skills = doc.skills.map(line => guard(line, '技能')).filter((line): line is TailorDocLine => !!line);
  if (preferences.separateDevTools) {
    const tools: TailorDocLine[] = [];
    skills = skills.flatMap(line => {
      if (!/^AI|^人工智能|^大模型/.test(line.text) || !/\bGit\b|GitHub|Gitee/i.test(line.text)) return [line];
      const at = line.text.search(/(?:熟悉|熟练|了解|使用过|接触)?\s*\bGit\b|GitHub|Gitee/i);
      tools.push({ text: `开发工具：${line.text.slice(at)}`, source: line.source });
      const text = line.text.slice(0, at).replace(/[；;，,、\s]+$/, '');
      return /[:：]\s*$/.test(text) ? [] : [{ ...line, text }];
    });
    skills.push(...tools);
  }
  let selfEval = guard(doc.selfEval, '简介');
  if (!selfEval) {
    const lines = facts.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const afterTitle = lines.findIndex(line => /^(?:个人简介|自我评价)$/.test(line));
    const text = afterTitle >= 0 ? lines[afterTitle + 1] : lines.find(line => /本科|在读|在校|专业/.test(line) && line.length > 20);
    selfEval = text && !excluded(text) ? { text: preferred(text), source: text } : { text: '', source: '' };
  }
  const originalProjects = preferences.preserveProjectText ? originalResumeProjects(facts, preferences) : [];
  const projects = originalProjects.length ? originalProjects : blocks(doc.projects, '项目').slice(0,
    !preferences.preserveProjectText && preferences.preferTwoProjectsWithExperience && (doc.internships.length || doc.works.length) ? 2 : doc.projects.length);
  return {
    doc: { ...doc, education: blocks(doc.education, '教育'), internships: blocks(doc.internships, '实习'), works: blocks(doc.works, '工作'),
      projects, skills, selfEval, honors: doc.honors.filter(line => !excluded(line)).map(preferred) },
    corrections: [...new Set(corrections)],
  };
}

const NUMBER = '[一二三四五六七八九十两\\d]+';
function durationNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) { const [tens, ones] = value.split('十'); return (digits[tens] || 1) * 10 + (digits[ones] || 0); }
  return digits[value] || 0;
}
function durationValues(text: string, kind: 'months' | 'weeklyDays'): number[] {
  const pattern = kind === 'months'
    ? new RegExp(`(?<!\\d)(${NUMBER})\\s*(年|个?月)`, 'g')
    : new RegExp(`(?:每周\\s*(${NUMBER})\\s*天|(?<!\\d)(${NUMBER})\\s*天\\s*(?:[\\/／]\\s*周|每周|一周))`, 'g');
  return [...text.matchAll(pattern)].map(match => {
    const value = durationNumber(match[1] || match[2]);
    return value > 0 && value < 100 ? value * (kind === 'months' && match[2] === '年' ? 12 : 1) : 0;
  }).filter(value => value > 0);
}

export function resumeBodyText(doc: TailorResumeDoc): string {
  return [doc.selfEval.text, ...doc.skills.map(line => line.text), ...doc.honors,
    ...[...doc.education, ...doc.internships, ...doc.works, ...doc.projects].flatMap(block => [block.heading, block.meta, ...block.bullets.map(line => line.text)])].join('\n');
}

/** Particular prerequisites cannot be proved by neighbouring keywords or course lists. */
export function pointProofIsSpecific(point: string, quotes: string[]): boolean {
  const proof = quotes.join('\n');
  if (/希望|计划|准备学习|没有做过|未做过|不具备|尚未|未实现|未上线|未负责|不负责|未参与|不涉及/.test(proof)) return false;
  if (unsupportedClaim(point, proof)) return false;
  if (/\bSQL\b/i.test(point) && !/\bSQL\b/i.test(proof)) return false;
  if (/问题.{0,4}(?:分析|解决)|分析.{0,4}解决/.test(point) && !/排查|定位|调试|修复|解决|缺陷|异常.{0,4}处理|问题.{0,4}分析/.test(proof)) return false;
  if (/embedding/i.test(point) && !/embedding|嵌入|向量化/i.test(proof)) return false;
  if (/向量库|Milvus|Chroma/i.test(point) && !/向量库|Milvus|Chroma/i.test(proof)) return false;
  for (const term of ['数据挖掘', '清洗']) if (point.includes(term) && !proof.includes(term)) return false;
  for (const term of ['误报', '漏报']) if (point.includes(term) && !proof.includes(term)) return false;
  if (/误报|漏报/.test(point) && /记录/.test(point) && !/记录|统计|日志/.test(proof)) return false;
  if (/(?:API|接口).*(?:测试|验证)/i.test(point) && !quotes.some(quote => {
    const api = /模型\s*API/i.test(point) ? /模型\s*API/i.test(quote) : /API|接口/i.test(quote);
    return api && /测试|验证|调试/.test(quote);
  })) return false;
  for (const kind of ['months', 'weeklyDays'] as const) {
    const requirements = durationValues(point, kind);
    if (requirements.length && !requirements.every(required => quotes.some(quote => {
      if (kind === 'months' && /研究|深度学习/.test(point) && !/研究|深度学习/.test(quote)) return false;
      return durationValues(quote, kind).some(actual => actual >= required);
    }))) return false;
  }
  if (/API.*(?:设计|开发)|接口.*(?:设计|开发)/i.test(point) && !quotes.some(quote => API_ACTION.test(quote))) return false;
  if (/算法研发|算法设计优化/.test(point) && !/算法.{0,8}(研发|设计|优化)|(研发|优化).{0,8}算法/.test(proof)) return false;
  return true;
}
