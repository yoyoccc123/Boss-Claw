import type { JobMeta, Profile } from './types';

/** The user wants relevant experience visible in the first ten preview characters. */
export const GREETING_PREVIEW_RULE = `【招呼语开头顺序：岗位相关经验优先】
按前10个字预览设计：开头直接给出与本岗位相关、本人确实做过的动作或项目关键词；不要以“您好”“我想应聘贵公司”“我是某专业学生”占用开头。示例仅表示写法，不是本人事实：“写过Python脚本”“RAG应用集成实践”“做过YOLO训练”。
随后用1-2个已有项目说明本人动作、技术链路或验证方式，联系JD明确提到的工作难点；不重复职位全称和技术栈清单。身份可放在中后段，结尾只用一句自然的交流邀请。
简历没有相关经验时先点明应聘方向，再表达想参与的任务；不能把希望、方案、课程或别人的项目改成自己做过的经历。痛点只用于选择和组织真实经验，不是新增履历的来源。本条开头顺序优先于旧技能或已保存提示词里的固定寒暄开头；仍遵守原有长度、第一人称和校名披露规则。`;

interface Opening { text: string; keyword: RegExp; source: string }
const DEFINITIONS: Array<{ job: RegExp; fact: RegExp; text: string; keyword: RegExp }> = [
  { job: /RAG|知识库|检索/i, fact: /RAG/i, text: 'RAG相关项目实践。', keyword: /RAG/i },
  { job: /大模型|Agent|AI.?应用|AI.?开发/i, fact: /大模型\s*API/i, text: '做过大模型API集成。', keyword: /大模型|API/i },
  { job: /测试|QA|质量/i, fact: /(?:功能|模块|流程).{0,15}测试|测试.{0,15}(?:功能|模块|流程)/, text: '做过项目功能测试。', keyword: /测试|验证/ },
  { job: /YOLO|视觉|视频|目标检测|图像/i, fact: /YOLO[^。；\n]{0,40}训练|训练[^。；\n]{0,40}YOLO/i, text: '做过YOLO训练。', keyword: /YOLO/i },
  { job: /OpenCV|视觉|视频|图像/i, fact: /OpenCV/i, text: 'OpenCV视觉实践。', keyword: /OpenCV/i },
  { job: /FastAPI|后端|接口/i, fact: /FastAPI/i, text: 'FastAPI实践。', keyword: /FastAPI/i },
  { job: /Flask|后端|业务系统/i, fact: /Flask/i, text: '参与Flask原型。', keyword: /Flask/i },
  { job: /Python|自动化|脚本/i, fact: /(?:编写|写过|开发)[^。；\n]{0,30}Python[^。；\n]{0,20}脚本|Python[^。；\n]{0,30}(?:编写|写过|开发)[^。；\n]{0,15}脚本/i, text: '写过Python脚本。', keyword: /Python/i },
];

export function pickGreetingOpening(job: JobMeta, profile: Profile | null, resumeText = ''): Opening | null {
  // Prefer raw applicant input; profile skill names alone do not prove experience.
  const facts = resumeText.trim() || [...(profile?.facts?.projects || []), ...(profile?.facts?.experiences || [])].join('\n');
  const lines = facts.split(/[。；\n]/).map(line => line.trim()).filter(Boolean);
  const actions = /参与|完成|实践|集成|验证|编写|写过|开展|进行|开发|训练/;
  const candidates = DEFINITIONS.map((definition, index) => {
    const source = lines.find(line => definition.fact.test(line) && actions.test(line)
      && !/^(?:编程|视觉|应用|AI|专业技能|技术栈|技能|开发工具|后端|前端)[：:]/i.test(line)
      && !/希望|计划|准备|尚未|未(?:参与|做过|完成|实践|集成|开发|开展|实现|训练)|没有(?:做过|参与|完成|实践|开发|集成)|仅.{0,8}(?:方案|设计)/.test(line));
    // Require the particular action being claimed, not merely the framework name.
    const supported = source && (/API集成/.test(definition.text) ? /参与|完成|使用|实践|进行|接入|对接/.test(source) && /集成|接入|对接/.test(source)
      : /Flask/.test(definition.text) ? /原型/.test(source) : true);
    const score = (definition.job.test(job.title || '') ? 10 : 0) + (definition.job.test(job.description || '') ? 3 : 0);
    return supported && score ? { ...definition, source, score, index } : null;
  }).filter((item): item is NonNullable<typeof item> => !!item).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = candidates[0];
  return chosen ? { text: chosen.text, keyword: chosen.keyword, source: chosen.source } : null;
}

/** Reorder a generated greeting without inventing a new project or changing its body. */
export function experienceFirstGreeting(text: string, job: JobMeta, profile: Profile | null, resumeText = ''): string {
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  if (!raw) return raw;
  const chosen = pickGreetingOpening(job, profile, resumeText);
  const firstSentence = raw.split(/[。！？!?]/)[0];
  const title = String(job.title || '相关岗位').split(/[【\[(（]/)[0].trim();
  if (!chosen && raw.startsWith(`应聘${title}。`)) return raw;
  if (chosen && chosen.keyword.test(Array.from(raw).slice(0, 10).join('')) && /做过|写过|参与|完成|实践|集成|开发|训练/.test(firstSentence)) return raw;
  // Remove the old opening only when it is a greeting plus an application statement.
  // Keep every experience/identity sentence, including a first sentence with real work.
  const body = raw.replace(/^(?:您好[！!，,\s]*)?(?:我想|我希望)?应聘(?:贵公司(?:的)?)?[^。！？!?]{0,100}(?:岗位|职位)[。！？!?]\s*/, '').replace(/^您好[！!，,\s]*/, '');
  return (chosen?.text || `应聘${title}。`) + body;
}
