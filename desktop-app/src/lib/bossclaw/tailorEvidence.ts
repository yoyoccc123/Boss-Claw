import type { TailorDocLine, TailorJdPoint, TailorResult, TailorResumeDoc, TailorSupplement } from './jobAssistant';
import { factKey, hasFactQuote, pointProofIsSpecific, resumeBodyText, unsupportedClaim } from './resumeFacts';

export const tailorPointKey = (point: Pick<TailorJdPoint, 'point' | 'layer'>) => `${point.layer}:${factKey(point.point)}`;
/** The modal's JD locator is a requirement, not a statement of applicant ability. */
export const tailorSupplementFacts = (text: string) => text.replace(/^\s*【岗位要点[：:][^\n】]*】\s*$/gm, '').trim();
const correction = /删除|删掉|去掉|移除|不要|不再|无需|没有|并非|不是|未(?:做|用|参与|负责|接触|实现)|不(?:用|使用|具备|熟悉|熟练|会|涉及)|纠正|更正|改成|改为|已毕业/;
const locatedPoint = (text: string) => text.match(/^\s*【岗位要点[：:]([^\n】]+)】/m)?.[1];
const globalCorrection = /全部|整份|所有要点|(?:以前|之前).{0,8}都/;
const correctionTopics = [/AI\s*(?:编程|Coding)|Vibe\s*Coding|Claude|Codex|Cursor|Trae|Copilot|Windsurf/i,
  /\bGit\b|GitHub|Gitee/i, /Docker|容器/i, /\bSQL\b|MySQL|SQLite|数据库/i, /Python/i,
  /毕业|学历|本科|学士|硕士|博士|在读|在校/, /企业|生产|线上|商业/, /部署|发布/,
  /API|接口|HTTP/i, /LangChain/i, /RAG|知识库/i, /Prompt|提示词/i, /YOLO|视觉|图像/i,
  /沟通|协作/, /逻辑|思维|学习能力/];
export function hasTailorPointCorrection(point: string, supplements: TailorSupplement[] = [], from = 0): boolean {
  return supplements.slice(from).some(s => {
    if (!correction.test(s.text)) return false;
    const target = locatedPoint(s.text);
    const content = tailorSupplementFacts(s.text);
    if (globalCorrection.test(content)) return true;
    const subject = point.replace(/熟练|熟悉|掌握|了解|使用|工程|实践|经验|基础|能力/g, '').trim();
    if (/删除|删掉|去掉|移除|不要/.test(content) && subject.length > 1 && factKey(content).includes(factKey(subject))) return true;
    const topics = correctionTopics.filter(topic => topic.test(content));
    // Denying enterprise deployment does not retract personal Docker basics, nor Git/tool use.
    if (topics.length) return topics.some(topic => topic.test(point));
    return target ? factKey(target) === factKey(point) : true;
  });
}
export function isAdditiveTailorIteration(previous: TailorResult | undefined, supplements: TailorSupplement[]): boolean {
  if (!previous) return false;
  const old = previous.supplements || [];
  return old.every((s, i) => s.text === supplements[i]?.text)
    && !supplements.slice(old.length).some(s => correction.test(s.text) && globalCorrection.test(tailorSupplementFacts(s.text)));
}

export function sourceFactQuotes(source: string, facts: string): string[] {
  if (hasFactQuote(source, facts)) return [source];
  const parts = source.split(/[；;\n]/).map(s => s.trim()).filter(Boolean);
  return parts.length && parts.every(q => hasFactQuote(q, facts)) ? parts : [];
}

/** A past green label alone is insufficient: both sets of quotations must still hold. */
export function retainedPointProof(point: TailorJdPoint, previous: TailorResult | undefined, facts: string, doc: TailorResumeDoc) {
  const old = previous?.jdPoints?.find(p => tailorPointKey(p) === tailorPointKey(point));
  const factQuotes = old?.factQuotes || [], bodyQuotes = old?.bodyQuotes || [];
  if (!old?.statusVerified || old.verdict !== 'covered' || !factQuotes.length || !bodyQuotes.length) return null;
  if (!factQuotes.every(q => hasFactQuote(q, facts)) || !bodyQuotes.every(q => hasFactQuote(q, resumeBodyText(doc)))) return null;
  if (!pointProofIsSpecific(point.point, factQuotes) || !pointProofIsSpecific(point.point, bodyQuotes)) return null;
  return { factQuotes, bodyQuotes };
}

const canonical = (text: string) => factKey(text).replace(/[，。；：、,.;:!?！？"'“”‘’（）()【】\[\]·\-—–~～|｜\/／]/g, '');
const aiTools = /AI\s*(?:编程|Coding)|Vibe\s*Coding|Claude\s*Code|Codex|Cursor|Trae|Copilot|Windsurf/i;
const proficiency = (text: string) => /精通/.test(text) ? 5 : /熟练/.test(text) ? 4 : /熟悉|掌握|擅长/.test(text) ? 3 : /了解|接触/.test(text) ? 1 : 0;
function directSkillProof(point: string, quote: string): boolean {
  if (!pointProofIsSpecific(point, [quote])) return false;
  if (aiTools.test(point)) {
    // The qualifier must belong to these tools, rather than an unrelated Git/Python clause.
    return [...quote.matchAll(/(精通|熟练|熟悉|掌握|擅长|了解|接触)([^。；;，,\n]*?)(?=精通|熟练|熟悉|掌握|擅长|了解|接触|[。；;，,\n]|$)/g)]
      .some(match => aiTools.test(match[2]) && proficiency(match[1]) >= proficiency(point));
  }
  if (!/^(?:精通|熟练|熟悉|掌握|擅长|了解|接触)/.test(point)) return false;
  return canonical(quote).includes(canonical(point));
}

function educationMeets(point: string, text: string): boolean {
  const rank = (value: string) => /博士/.test(value) ? 4 : /硕士|研究生/.test(value) ? 3 : /本科|学士/.test(value) ? 2 : /大专|专科/.test(value) ? 1 : 0;
  if (!rank(point) || rank(text) < rank(point) || !pointProofIsSpecific(point, [text])) return false;
  // Slash-separated graduation cohorts are alternatives. Award/start years are not graduation evidence.
  const years = point.match(/20\d{2}/g) || [];
  const graduates = [...text.matchAll(/(20\d{2})\s*届|20\d{2}[.年/\-]\d{1,2}\s*(?:月)?\s*[-—–~～至]\s*(20\d{2})[.年/\-]\d{1,2}/g)].map(m => m[1] || m[2]);
  if (years.length && !years.some(year => graduates.includes(year))) return false;
  for (const kind of ['全日制', '统招']) if (point.includes(kind) && !text.includes(kind)) return false;
  const now = new Date(), currentMonth = now.getFullYear() * 12 + now.getMonth();
  const activeRange = [...text.matchAll(/(20\d{2})[.年/\-](\d{1,2})\s*月?\s*[-—–~～至]\s*(20\d{2})[.年/\-](\d{1,2})/g)]
    .some(m => Number(m[1]) * 12 + Number(m[2]) - 1 <= currentMonth && Number(m[3]) * 12 + Number(m[4]) - 1 >= currentMonth);
  if (/在读|在校/.test(point) && !/在读|在校|至今/.test(text) && !activeRange
    && !(/本科生|研究生/.test(text) && graduates.some(year => Number(year) > now.getFullYear()))) return false;
  if (/应届/.test(point) && !graduates.some(year => Number(year) >= now.getFullYear() && Number(year) <= now.getFullYear() + 1)) return false;
  return true;
}

/** Conservative, grounded recovery for literal skills and explicit education, never keyword-only inference. */
export function directTailorPointProof(point: string, doc: TailorResumeDoc, facts: string, supplements: TailorSupplement[] = []) {
  if (hasTailorPointCorrection(point, supplements)) return null;
  for (const line of [...doc.skills, doc.selfEval, ...[...doc.education, ...doc.internships, ...doc.works, ...doc.projects].flatMap(b => b.bullets)]) {
    const factQuotes = sourceFactQuotes(line.source, facts);
    if (factQuotes.length && !unsupportedClaim(line.text, factQuotes.join('\n'))
      && directSkillProof(point, line.text) && factQuotes.some(q => directSkillProof(point, q))) return { factQuotes, bodyQuotes: [line.text] };
  }
  if (!/本科|学士|硕士|博士|研究生|大专|专科/.test(point)) return null;
  // Degree proof alone cannot satisfy major/school-tier/language or other compound conditions.
  const extraRequirement = canonical(point).replace(/20\d{2}|本科|学士|硕士|博士|研究生|大专|专科|学历|及以上|以上|及|在读|在校|应届|届|毕业生|毕业|学生|全日制|统招|年/g, '');
  if (extraRequirement) return null;
  const rows = facts.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const start = rows.findIndex(s => /^(?:教育背景|教育经历)$/.test(s));
  const end = rows.findIndex((s, i) => i > start && /^(?:个人简介|自我评价|个人荣誉|荣誉证书|专业技能|工作经历|实习经历|项目经历)$/.test(s));
  const education = start >= 0 ? rows.slice(start + 1, end >= 0 ? end : rows.length) : rows.filter(s => /(?:本科生|在读|在校|20\d{2}\s*届)/.test(s));
  // A whole original education block is an exact, self-contained quotation.
  const factQuote = education.join('\n');
  if (!hasFactQuote(factQuote, facts) || !educationMeets(point, factQuote)) return null;
  for (const block of doc.education) {
    const bodyQuote = [block.heading, block.meta, ...block.bullets.map(l => l.text)].filter(Boolean).join('\n');
    if (educationMeets(point, bodyQuote)) return { factQuotes: [factQuote], bodyQuotes: [bodyQuote] };
  }
  // Graduation identity may also be stated explicitly in the personal summary.
  if (educationMeets(point, doc.selfEval.text)) return { factQuotes: [factQuote], bodyQuotes: [doc.selfEval.text] };
  return null;
}

/** Recover only previously verified, still sourced wording that an additive rewrite accidentally omitted. */
export function preserveTailorCoverage(previous: TailorResult, current: TailorResult, facts: string) {
  const doc: TailorResumeDoc = JSON.parse(JSON.stringify(current.doc));
  const restored: string[] = [];
  const grounded = (line: TailorDocLine) => sourceFactQuotes(line.source, facts).length > 0 && !unsupportedClaim(line.text, line.source);
  const knownField = (value: string) => value.split(/[\s|｜]+/).filter(Boolean).every(part => canonical(facts).includes(canonical(part)));
  for (const point of previous.jdPoints || []) {
    if (hasTailorPointCorrection(point.point, current.supplements, previous.supplements?.length || 0)) continue;
    if (!retainedPointProof(point, previous, facts, previous.doc)) continue;
    if (current.jdPoints.some(p => tailorPointKey(p) === tailorPointKey(point) && p.statusVerified && p.verdict === 'covered')) continue;
    const missing = (point.bodyQuotes || []).filter(q => !hasFactQuote(q, resumeBodyText(doc)));
    if (!missing.length) continue;
    const used = (text: string) => missing.some(q => hasFactQuote(q, text));
    const before = resumeBodyText(doc);
    for (const line of previous.doc.skills) if ((used(line.text) || missing.some(q => hasFactQuote(line.text, q))) && grounded(line) && !hasFactQuote(line.text, resumeBodyText(doc))) doc.skills.push({ ...line });
    for (const module of ['education', 'internships', 'works', 'projects'] as const) for (const old of previous.doc[module]) {
      const body = [old.heading, old.meta, ...old.bullets.map(l => l.text)].join('\n');
      if (!used(body)) continue;
      let target = doc[module].find(b => canonical(b.heading.split(/[|｜]/)[0]) === canonical(old.heading.split(/[|｜]/)[0]));
      if (!target && knownField(old.heading) && knownField(old.meta)) {
        target = { heading: old.heading, meta: old.meta, bullets: [] }; doc[module].push(target);
      }
      if (!target) continue;
      if (knownField(old.heading) && (used(old.heading) || missing.some(q => hasFactQuote(old.heading, q)))) target.heading = old.heading;
      if (knownField(old.meta) && (used(old.meta) || missing.some(q => hasFactQuote(old.meta, q)))) target.meta = old.meta;
      for (const line of old.bullets) if (grounded(line) && (used(line.text) || missing.some(q => hasFactQuote(line.text, q)))
        && !hasFactQuote(line.text, resumeBodyText(doc))) target.bullets.push({ ...line });
    }
    if (used(previous.doc.selfEval.text) && grounded(previous.doc.selfEval)) {
      const sentences = previous.doc.selfEval.text.match(/[^。！？!?\n]+[。！？!?]?/g) || [];
      const additions = sentences.filter(s => missing.some(q => hasFactQuote(q, s) || hasFactQuote(s.trim(), q)) && !hasFactQuote(s.trim(), resumeBodyText(doc)));
      if (additions.length) doc.selfEval = { text: [doc.selfEval.text, ...additions].filter(Boolean).join('\n'),
        source: [doc.selfEval.source, previous.doc.selfEval.source].filter(Boolean).join('；') };
    }
    for (const line of previous.doc.honors) if (used(line) && hasFactQuote(line, facts) && !hasFactQuote(line, resumeBodyText(doc))) doc.honors.push(line);
    if (resumeBodyText(doc) !== before) restored.push(point.point);
  }
  return { doc, restored };
}
