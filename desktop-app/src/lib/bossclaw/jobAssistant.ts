// AI 求职助手 —— 根据岗位定制简历（结构化七模块文档 + JD 要点对照 + 同口径匹配分 + 求职信/打招呼语）
// 参考 GitHub 开源项目 Anarkh-Lee/resume-alchemist 的优化方法论（按 JD 编写能力 / JD 关键词优化 /
//   STAR 法则润色经历），并兼容 MadsLorentzen/ai-job-search 的 /apply 流程与 Resume-Matcher 引导式建议：
//   - 经历要点允许「量化改写」（仅提炼简历已有数字，严禁编造）；对标 resume-alchemist 的量化成果；
//   - 能力/技能按 JD 适当编写（放大匹配点），但硬性事实（经历/学历/证书/数字/承诺）绝不编造；
//   - 输出可执行的 ATS 优化建议清单；对标 Resume-Matcher 的 guided improvements。
// 落地为 BOSS 直聘场景：输入岗位 JD，基于简历/画像真实事实，生成岗位针对性内容。
//
// 结构口径（2026-09-14 定）：
//   - 定制产出「七模块结构化简历文档」（教育经历/实习经历/工作经历/项目经历/专业技能/个人荣誉/自我评价），
//     模块顺序与「空模块不输出」由渲染层决定，AI 只填内容；
//   - 每条定制后内容都要挂一条「原文摘录」（source）：挂不上原文的条目在 UI 中标为需人工核对，
//     把「编造」在结构上暴露出来，而不是靠事后审查；
//   - 「匹配度」改为 AI 同口径判定：同一次调用、同一份 JD 要点清单、同一套标准，输出 before/after 两个分，
//     解决旧的「原简历+定制内容拼接重算 → 前后恒等」问题（本地算法仅作 AI 不可用时的兜底展示）；
//   - 「岗位要点对照」改为 AI 分层要点（硬门槛/优先条件/职责信号/团队信号）× 三层判定（已体现/可补充/不具备）；
//   - 二轮 Reviewer 复检保留，但其修订差异不再单独展示，面板统一展示「原文摘录 → 定制后条目」逐条对照。
//
// 安全不变量（对齐 AGENTS.md 2.1）：
//   - 能力/技能可按 JD 适当编写（放大匹配点），但经历、学历、证书、量化数字与任何承诺绝不编造；
//   - 量化只允许提炼简历中已有的数字（规模/时长/效率），简历没有数字就保持事实描述，严禁编造百分比、金额、用户量；
//   - 求职信必须求职者第一人称口吻，禁止招聘方口吻（复用打招呼语校验口径）；
//   - AI 输出不达标一律回退本地规则兜底，绝不把招聘方口吻的文本交给用户。
import type { AppConfig, JobMeta, Profile } from './types';
import { cachedCallModel, aiFailureKind } from './llm';
import { reloadSkills, skillInstructionsFor } from './skills';
import { stableProfileView, fallbackApplicantGreeting, settleGreetingLength } from './matching';
import { allocateContextBudget, estimateTokens, fitContextToTokens, resolveContextBudget } from './contextBudget';
import { prepareContextText } from './oversizedContext';
import { DEFAULT_ANALYZE_GREETING_INSTRUCTIONS } from './prompts';
import { PROJECT_WRITING_RULE, resumePreferenceRule, type ResumeWritingPreferences } from './resumeWriting';
import { GREETING_PREVIEW_RULE } from './greetingPreview';
import { enforceResumeFacts, hasFactQuote, pointProofIsSpecific, resumeBodyText, unsupportedClaim } from './resumeFacts';
import { auditResumeFacts } from './resumeFactAudit';
import { buildSchoolDisclosureRule, hasSchoolMention, resolveSchoolTier } from './schoolTier';
import { normalizeStringList } from './helpers';
import { decodeSalaryDigits } from './jobDisplay';
import {
  analyzeJdKeywords,
  buildLocalSuggestions,
  computeMatchScore,
  extractJdKeywords,
  resumeHasQuantifiedEvidence,
  type JdKeywordAnalysis,
  type MatchScore,
} from './resumeMatch';

// ===== 结构化简历文档（七模块）=====
/** 定制简历文档中的一条内容：text=定制后文本；source=原简历/经历补充材料中的原文摘录（照抄，未改写真） */
export interface TailorDocLine {
  text: string;
  source: string;
}

/** 定制简历文档的一个「块」（教育经历/实习经历/工作经历/项目经历共用） */
export interface TailorDocBlock {
  /** 块首行：项目/公司/学校名 + 角色或专业学历 */
  heading: string;
  /** 第二行元信息：技术栈：… / 时间：… */
  meta: string;
  /** 要点 */
  bullets: TailorDocLine[];
}

/** 定制简历文档（七模块；空模块为空数组/空对象，由渲染层决定顺序与省略） */
export interface TailorResumeDoc {
  education: TailorDocBlock[];
  internships: TailorDocBlock[];
  works: TailorDocBlock[];
  projects: TailorDocBlock[];
  /** 专业技能：按类别分组，每项 text 形如「后端：精通 Java、熟悉 MyBatis」（**必须保留描述语**） */
  skills: TailorDocLine[];
  honors: string[];
  selfEval: TailorDocLine;
}

export const EMPTY_TAILOR_DOC: TailorResumeDoc = {
  education: [],
  internships: [],
  works: [],
  projects: [],
  skills: [],
  honors: [],
  selfEval: { text: '', source: '' },
};

/** JD 要点层级（对齐 JD 拆解方法的四层信息） */
export type JdPointLayer = 'must' | 'prefer' | 'duty' | 'team';
/** JD 要点在候选人侧的体现情况：covered 简历已体现 / addable 画像或补充材料具备但简历未写 / missing 完全没有 */
export type JdPointVerdict = 'covered' | 'addable' | 'missing';

export interface TailorJdPoint {
  /** 要点（≤12 字，同类已合并） */
  point: string;
  layer: JdPointLayer;
  verdict: JdPointVerdict;
  /** 一句依据（≤30 字，必须是可核对的简历事实） */
  evidence: string;
  /** 判定是否对应最终交付正文；缺失表示旧历史尚未复核。 */
  statusVerified?: boolean;
  factQuotes?: string[];
  bodyQuotes?: string[];
}

/** AI 同口径匹配度：before=原简历+补充材料+画像；after=定制后简历文档 */
export interface TailorAiMatch {
  before: number;
  after: number;
}

export interface TailorSupplement {
  text: string;
  createdAt: number;
}

export interface TailorIterationInput {
  resumeSource?: import('./resumeVariants').ResumeSourceSnapshot;
  supplements?: TailorSupplement[];
  previousResult?: TailorResult;
  writingPreferences?: ResumeWritingPreferences;
}

export interface TailorPointDraft {
  text: string;
  missingDetails: string[];
}

/** 为单个岗位要点整理用户补充，草稿须由用户确认后才参与重新生成。 */
export async function writeTailorPointSupplement(input: {
  point: TailorJdPoint; text: string; job: JobMeta; resumeText: string; profile: Profile | null;
  model: AppConfig['model']; extraMaterials?: string; supplements?: TailorSupplement[]; writingPreferences?: ResumeWritingPreferences;
}): Promise<TailorPointDraft> {
  if (!input.text.trim()) throw new Error('请先写几句实际技能或经历，再让 AI 整理');
  if (!input.model?.apiKey) throw new Error('请先配置 AI 模型');
  const budget = allocateContextBudget(input.model, { resume: 0.4, extra: 0.25, profile: 0.1, text: 0.15, point: 0.1 }, { outputTokens: 1200 });
  const resume = (await prepareContextText(input.resumeText, input.model, {
    tokenBudget: budget.resume, focus: '与当前岗位要点相关的真实技能和经历，保留能力水平、项目职责与数字',
    cacheScope: 'assistant', purpose: '要点续写-简历事实',
  })).text;
  const extra = [input.extraMaterials, ...(input.supplements || []).map((s, i) => `第${i + 1}轮补充（区分事实与修改要求）：${s.text}`)].filter(Boolean).join('\n\n');
  const extraCtx = extra ? (await prepareContextText(extra, input.model, {
    tokenBudget: budget.extra, focus: '保留本人明确提供的事实、否定和修改要求，不把愿望变成事实',
    cacheScope: 'assistant', purpose: '要点续写-已有补充', mode: 'transform',
    instruction: '保留补充资料的事实、否定、纠错和修改要求，明确区分事实与愿望；禁止把希望具备的技能写成已具备。',
  })).text : '';
  const response: any = await cachedCallModel([
    { role: 'system', content: `你是求职者的简历编辑，针对指定岗位要点整理或续写本人输入的补充草稿，供本人确认。
只使用简历、画像、既有补充与本轮输入里明确陈述的事实。岗位要求只是目标，不是求职者已经具备的事实；当前判定依据也仅供编辑参考。
保留“了解/熟悉/参与/负责”等原有水平和职责，不能把了解升级成熟练/精通，不能把参与改成独立负责。
不得编造项目、框架名称、职责、数字、成果、工作时长、到岗或面试承诺。本人明确说“没有做过”或“希望学习”的内容，必须保留否定或计划性质。
本轮资料足以说明“了解”某技能时，可直接整理成技能表述，不强求项目细节。资料不足时，只整理能确认的部分，并在 missingDetails 提出最多3个具体问题；不要用占位符补造未知事实。
${PROJECT_WRITING_RULE}${resumePreferenceRule(input.writingPreferences)}
text 用求职者口吻写成可直接提交的补充文字，保留用户输入中的有效事实；只输出 JSON：{"text":"整理或续写的草稿","missingDetails":["尚需本人确认的问题"]}。` },
    { role: 'user', content: `目标：${fitContextToTokens(JSON.stringify({ jobTitle: input.job.title, company: input.job.company, point: input.point.point, layer: input.point.layer }), budget.point)}
简历事实：${resume}
职业画像：${fitContextToTokens(JSON.stringify(input.profile ? stableProfileView(input.profile) : {}), budget.profile)}
既有资料与补充：${extraCtx}
本人本轮输入：${fitContextToTokens(input.text, budget.text)}` },
  ], input.model, { maxTokens: 1200, temperature: 0.2 }, { scope: 'assistant' });
  const text = typeof response?.text === 'string' ? response.text.trim() : '';
  if (!text) throw new Error('AI 未返回有效草稿，原输入已保留，可重试');
  return { text, missingDetails: normalizeStringList(response?.missingDetails, 3) };
}

/** 每轮文本独立保存，避免新补充覆盖前几轮的事实与修改要求。 */
export function appendTailorSupplement(previous: TailorSupplement[] = [], text: string, now = Date.now()): TailorSupplement[] {
  const trimmed = text.trim();
  return trimmed ? [...previous, { text: trimmed, createdAt: now }] : [...previous];
}

const ITERATION_RULE = `【多轮补充规则】
用户补充可能同时包含事实、纠错与修改要求。只有明确陈述的本人真实经历可作为事实来源；希望学会、希望达到100分、请加某技能等愿望或编辑指令不得转换成已具备的事实。
按时间顺序保留各轮有效补充；后续明确纠正前文时，以最新纠正为准。上一版仅是编辑参考，其内容和评分不能作为新的事实证据。
根据当前岗位要点、原始资料和全部有效补充重新生成完整简历，优先处理上一版缺口与建议，并保留仍然相关且有依据的内容。
重新评估实际匹配度，不因用户要求100分、轮数增加或上一轮分数而加分；无法补齐的要求如实保留在缺口和建议中。`;

/** 逐条改写对照（由文档里的 source/text 派生，保证与最终交付稿永远同步） */
export interface TailorRewrite {
  /** 所属模块中文名 */
  module: string;
  /** 定制后条目 */
  after: string;
  /** 原简历该条的原文摘录；空串表示未找到原文对应（需人工核对） */
  before: string;
  /** 原文摘录来源：resume 简历原文 / extra 经历补充材料 / none 未找到 */
  from: 'resume' | 'extra' | 'none';
}

export const JD_LAYER_LABEL: Record<JdPointLayer, string> = {
  must: '硬门槛',
  prefer: '优先条件',
  duty: '职责信号',
  team: '团队信号',
};

// ===== 输出 Schema =====
export const TAILOR_SCHEMA = JSON.stringify({
  highlightedSkills: [],
  tailoredSummary: '',
  tailoredExperiences: [],
  coverLetter: '',
  skillGaps: [],
  suggestions: [],
  resume: {
    education: [{ heading: '', meta: '', bullets: [{ text: '', source: '' }] }],
    internships: [{ heading: '', meta: '', bullets: [{ text: '', source: '' }] }],
    works: [{ heading: '', meta: '', bullets: [{ text: '', source: '' }] }],
    projects: [{ heading: '', meta: '', bullets: [{ text: '', source: '' }] }],
    skills: [{ text: '', source: '' }],
    honors: [],
    selfEval: { text: '', source: '' },
  },
  jdPoints: [{ point: '', layer: 'must|prefer|duty|team', verdict: 'covered|addable|missing', evidence: '' }],
  matchScore: { before: 0, after: 0 },
});

// 输出样例：官方 JSON Output 要求 prompt 给出「希望模型输出的 JSON 格式样例」。
// 仅示意字段格式与取值风格，内容必须来自简历/画像真实事实（模型不得照抄样例内容）。
const TAILOR_OUTPUT_EXAMPLE = `{
  "highlightedSkills": ["React", "TypeScript", "前端性能优化", "Git 分支协作"],
  "tailoredSummary": "计算机科学与技术专业在读本科生，具备 React + TypeScript 前端开发与 Node.js 接口联调经验，在商城项目中负责订单管理模块的页面开发与状态管理，熟悉组件化拆分与前后端联调流程。",
  "tailoredExperiences": [
    "在 XX 商城项目中负责订单管理模块，用 React + TypeScript 完成页面开发与状态管理，支撑下单到售后全流程交互",
    "在 XX 科技实习期间参与商家后台页面开发，配合后端完成接口联调并优化首屏渲染表现"
  ],
  "coverLetter": "React订单模块做过。我参与过基于 React + TypeScript 的商城订单管理模块，负责页面开发与状态管理；我是计算机科学与技术专业在读本科生，想应聘贵公司的前端开发实习生岗位，对岗位的工程化与性能优化方向很感兴趣，希望有机会进一步沟通，谢谢。",
  "skillGaps": ["Kubernetes：岗位要求容器编排与集群运维，简历与画像未体现相关经历，建议补充实操项目"],
  "suggestions": ["把商城项目的首屏优化数据前置到经历第一条", "在技能区补充 Jest 单元测试能力", "摘要中明确写出期望的前端工程化方向"],
  "resume": {
    "education": [
      { "heading": "XX大学 计算机科学与技术 | 本科在读（2027 届）", "meta": "2023.09-2027.06", "bullets": [{ "text": "连续两年获校级二等奖学金", "source": "连续两年获得学校二等奖学金" }] }
    ],
    "internships": [
      { "heading": "XX 科技 前端开发实习生", "meta": "2025.07-2025.09", "bullets": [{ "text": "参与商家后台页面开发，配合后端完成接口联调，并优化首屏渲染表现", "source": "参与商家后台页面开发，配合后端完成接口联调" }] }
    ],
    "works": [],
    "projects": [
      { "heading": "XX 商城系统 | 前端开发", "meta": "技术栈：React + TypeScript + Vite", "bullets": [{ "text": "负责订单管理模块的页面开发与状态管理，支撑下单到售后全流程交互", "source": "负责商城项目订单管理模块的页面开发与状态管理" }] }
    ],
    "skills": [
      { "text": "前端开发：熟悉 React、TypeScript、Vite，沉淀通用组件库", "source": "前端：熟悉 React、TypeScript、Vite，沉淀通用组件库" },
      { "text": "协作工具：熟练 Git 分支协作", "source": "工具：熟练 Git 分支协作" }
    ],
    "honors": ["2024 年蓝桥杯大学生 Java B 组省一等奖"],
    "selfEval": { "text": "全栈开发 + AI 应用双线实践者，独立完成过面向用户的 AI 功能产品。", "source": "全栈开发 + AI 应用双线实践者，独立完成过面向用户的 AI 功能产品。" }
  },
  "jdPoints": [
    { "point": "React 开发经验", "layer": "duty", "verdict": "covered", "evidence": "商城项目订单模块用 React 实现" },
    { "point": "前端工程化", "layer": "prefer", "verdict": "addable", "evidence": "画像中具备 Vite 构建与组件库沉淀经验" },
    { "point": "Kubernetes 部署", "layer": "must", "verdict": "missing", "evidence": "简历与画像均无容器编排相关经历" }
  ],
  "matchScore": { "before": 62, "after": 78 }
}`;

// 第二轮 Reviewer 输出样例：字段为 null 表示「该字段无需修订、保留草稿」。
const TAILOR_REVIEW_OUTPUT_EXAMPLE = `{
  "tailoredSummary": "计算机科学与技术专业在读本科生，具备 React + TypeScript 前端开发经验，在商城项目中负责订单管理模块的页面开发与状态管理，熟悉组件化拆分与接口联调流程。",
  "tailoredExperiences": null,
  "highlightedSkills": null,
  "coverLetter": null,
  "skillGaps": null,
  "suggestions": null,
  "resume": null,
  "jdPoints": [{ "point": "React 开发经验", "layer": "duty", "verdict": "covered", "evidence": "最终项目经历已写明 React 订单模块" }],
  "matchScore": { "before": 62, "after": 78 },
  "reviewNote": "摘要原稿罗列了多项技术栈，已改写为「身份 + 1-2 个最相关亮点」；逐条核对 resume 的 source 与 text，未发现超出原文的表述；其余字段保持草稿。"
}`;

// ===== 系统提示词 =====
// 求职信（coverLetter）的打招呼语提示词由调用方按「skill → 简历中心输入框内容」优先级解析后传入（都不满足则回退本地规则），
// 与工作台岗位分析、简历中心预览共用同一口径。
export function buildTailorSystemPrompt(greetingInstructions: string, schoolRule = ''): string {
  return `你是求职者的求职助手（不是招聘方）。任务：先读懂目标岗位 JD，再据此定制简历——产出「结构化简历文档（七模块）」「JD 要点对照清单」「定制前/后同口径匹配分」「量化经历要点」「第一人称求职打招呼语（求职信）」与「可执行的优化建议」。

执行顺序：**先把 JD 按四层拆解读完（硬门槛 / 优先条件 / 职责信号 / 团队信号），再开始输出内容**；jdPoints、resume、highlightedSkills 必须是读完 JD 之后的结论，不得跳过拆解直接润色。

铁律：
1. 事实只来自本人简历原文、导入材料和确认的经历补充。职业画像仅作方向参考；岗位 JD 仅决定选择与排序，不能证明本人能力。
2. **按岗位选择已有事实，禁止推导新能力**：相关领域背景不等于具备该领域所有技能。做过页面不能写性能优化；用MySQL不能写表设计；API集成不能写接口设计、提示词工程或算法研发。未知能力进入缺口或具体追问，不能写成现有技能。
3. **保留原简历的能力描述语**：原文有水平时保持原强度，熟悉不能升级成熟练，了解不能升级成掌握。原文只是中性技能名称或“使用过/接触”，不得自动补上熟悉、掌握、熟练。不同技能不能借用同组其他技能的熟练程度。不要把带描述语的表述压成无修饰的技能罗列：
   - 原文：「前端：熟悉 React、TypeScript，沉淀通用组件库」
   - ✗ 错误：「前端：React、TypeScript、通用组件库」（描述语全丢，等于抹平水平差异）
   - ✓ 正确：「前端：熟悉 React、TypeScript，沉淀通用组件库」
   只列原文明确支持的技能，每个技能的描述语须由其自身事实支持。
4. **硬性事实红线（绝不逾越）**：不得虚构公司/职位/在职时长、学校/学历/专业、证书/奖项、具体数字/比例/金额/用户量/时长；不得承诺薪资、到岗时间、面试时间；与岗位能力域毫无交集、无法从真实背景合理外推的，绝不写进 tailoredSummary、highlightedSkills、resume 或 coverLetter 当作自己具备。触犯任一条即输出失败，交由本地规则兜底。
5. tailoredSummary 为 60-90 字求职者个人摘要：开头点明身份（学历/年级/专业），用 2-3 句突出岗位最相关的真实贡献，不罗列全部项目或重复整段技能栈。
6. tailoredExperiences 为 2-4 条经历要点：从真实经历中挑选与岗位最相关者，按 **STAR（情境/任务 → 行动 → 结果）** 精简为一句亮点重排（每条不超过 80 字）。[量化改写规则]：若简历事实本身含数字（如"服务 3 年""日活 5 万""耗时从 2 小时降到 30 分钟"），允许提炼为「行动动词 + 可量化成果」句式；若简历没有数字，必须保持事实描述，**严禁编造或推算任何百分比、金额、人数、用户量、时长**。
7. highlightedSkills 为 3-6 个不重复的「岗位适配技能」：按 JD 规范名编写与岗位匹配的真实能力，同义项合并；与岗位无关或与候选人背景毫无交集的一律不列。
8. skillGaps 为 1-4 个岗位明确要求、但本人事实尚未证明的能力或条件，不得因领域相近而隐藏缺口；没有则返回空数组。
9. coverLetter 为第一人称求职打招呼语（求职信），必须遵守以下工作台打招呼语提示词（本软件打招呼语统一口径，含开头格式、口吻、长度、安全红线）：
${greetingInstructions}${schoolRule}
10. suggestions 为 3-5 条「求职者可执行」的优化建议：基于简历与 JD 的真实差距给出，每条不超过 40 字，不得建议编造事实。

${PROJECT_WRITING_RULE}

【resume：结构化简历文档（七模块）】
- resume 是**可直接排版成 PDF 的定制简历正文**，不是摘要、不是备注。模块固定为：教育经历（education）/ 实习经历（internships）/ 工作经历（works）/ 项目经历（projects）/ 专业技能（skills）/ 个人荣誉（honors）/ 自我评价（selfEval）。顺序由程序决定，你只填内容。
- **没有内容的模块一律返回空数组或空对象，绝不编造内容去填充、也不写"暂无"**。
- education / internships / works / projects 每项 = { heading, meta, bullets }：heading 是首行（学校 + 专业 | 学历 / 公司 + 岗位 / 项目名 + 一句话定位 | 角色），meta 是第二行元信息（时间 / 「技术栈：…」），bullets 是要点。
- **每条 bullet 必须带 source**：source 是**原简历或经历补充材料里对应那一条的原文摘录，照抄不改写**。若该条与原文完全一致，source 照抄同样文本；若原文中确实找不到对应内容，source 填空字符串 ""（这类条会在界面上标为「需人工核对」，禁止用来塞进编造内容）。
- **改写只允许「重新表达」，不允许「新增事实」**：bullet 的 text 超出 source 能支撑的范围即为违规。
- projects 按 JD 相关性从高到低，仅选择最相关的 2-3 个项目，最多 3 个；实际不足时保留实际数量。课程实验与小型复现只在岗位明确相关时入选，不罗列全部开发经历。
- 每个项目优先保留 2-3 条要点，最多 3 条；实习/工作经历 1-3 条，每条建议 40-70 字、不得超过 80 字。事实不足时只写有依据的条数，不为凑数扩写。同一事实不要跨条重复，技术栈集中放 meta，bullet 写具体职责、实现方式或可验证成果。**bullet 同样受「保留能力描述语」约束**：原文写「负责」「参与」「配合」等动词或「熟练/熟悉」等描述语时，不得改写成无修饰的名词堆叠。
- 删除空泛的效果词：没有明确测试口径或用户/业务数据支持时，不写「毫秒级响应」「显著提升使用粘性」「大幅提升效率」等性能或业务成效；即使原文有这些笼统表述，也只保留可核对的功能、操作和技术实现，不推算指标。
- skills 为按类别分组的专业技能：每项 { text, source }，与 JD 相关的组排在前面。每组建议45-70字，避免长串工具；source逐字摘录原始技能或本人实践，不照抄画像推导。保留每项自身的原文水平；原文中性列举时允许同样列举，不人为添加熟悉、掌握、熟练。技术名称不能自动变成表设计、优化、开发等能力。
- skills 最多 4 个岗位相关分组，同一技能只在一组出现，合并同义词；保留原文的熟悉/了解等水平，不在简介和技能区重复整套清单。
- honors 为个人荣誉/证书纯文本条目数组；selfEval 为自我评价 { text, source }，用与 tailoredSummary 相同的精简简介（60-90 字），source 摘录支撑身份与贡献的原文，不写「学习能力强」「热爱技术」等无事例评价。
- **禁止输出空标题、占位符（如「（暂无）」「待补充」）或说明性文字**。

【jdPoints：JD 要点对照清单】
- 把 JD 拆成四层要点：must 硬门槛（学历/年限/语言/行业背景/远程出差）、prefer 优先条件（「优先/加分/更佳」）、duty 职责信号（每天到底要做什么）、team 团队信号（公司阶段/协作方式）。
- 同类合并、总数不超过 20 条，每条 point 不超过 12 字，不要罗列 JD 里的每个词。
- 每条给 verdict，必须以本次生成的 resume 正文为准，不能仍按原始简历或上一版判定：covered = 最终正文已明确体现且能力水平符合该要点；addable = 本人资料/补充中具备，但最终正文尚未体现；missing = 所有有效资料均未提供可支撑该能力的依据。
- 用户明确补充「了解数据库表设计」「了解 SQL 语法」「了解主流 Web 框架」等技能事实，可以如实写入 resume.skills 并保留「了解」水平，不需要先补充项目细节才允许写技能。写入后对应的「了解」要点应为 covered，依据引用最终技能正文；不得仍引用旧的「项目未写明」结论。用户只说了解时，不得写成熟悉/精通，也不得编造成某项目中负责设计或使用过某框架。
- evidence 一句话（不超过 30 字）说明依据，必须是可核对的简历事实；**不得把「优先/加分」写成硬性不满足**。
- 不要把职位名、公司名、招聘流程词（HR/面试/简历筛选）当作要点。

【matchScore：定制前/后同口径匹配分】
- before = 原简历 + 经历补充材料 + 职业画像 对这份 JD 的匹配度；after = **定制后的 resume 文档** 对这份 JD 的匹配度。
- 两者必须**基于同一份 jdPoints、用同一套判断标准**：按要点分层加权（硬门槛权重最高，优先条件次之，职责信号再次，团队信号仅作参考），各自给 0-100 整数。
- after 只有在定制确实补上了要点时才允许高于 before；**不允许为了好看而抬分**，也不允许两分自动设成差值固定值。若定制没有实质增益，after 与 before 持平即是正确结果。

【输出 schema】只输出以下字段（字段名与类型不可变更）：
${TAILOR_SCHEMA}

【输出样例】（仅示意字段格式与写法，内容必须来自简历/画像/补充材料的真实事实，不得照抄样例内容）：
${TAILOR_OUTPUT_EXAMPLE}

只输出一个 json 对象，不要解释、不要代码块围栏。`;
}

// ===== 第二轮：招聘方 + ATS 视角自检修订（Reviewer） =====
// 对齐 MadsLorentzen/ai-job-search 的 /apply 流程（drafter → reviewer → revise），
// 以及 llamaindex-pse 的 Planner-Specialist-Evaluator 审阅思想：
// 第一轮初稿后，再以招聘方/ATS 视角逐字段自检、修订，避免一次性生成带出
// 夸大表述、语气瑕疵、关键词覆盖不真实、口吻不当等问题。字段输出 null（或缺省）表示「保持草稿不变」。
export const TAILOR_REVIEW_SCHEMA = JSON.stringify({
  tailoredSummary: null,
  tailoredExperiences: null,
  highlightedSkills: null,
  coverLetter: null,
  skillGaps: null,
  suggestions: null,
  resume: null,
  jdPoints: [{ point: '', layer: 'must|prefer|duty|team', verdict: 'covered|addable|missing', evidence: '' }],
  matchScore: { before: 0, after: 0 },
  reviewNote: null,
});

export function buildReviewSystemPrompt(schoolRule = ''): string {
  return `你是资深招聘方 + ATS 简历审核专家，负责对上一轮 AI 已起草的「岗位定制简历」做第二轮回审与修订（对齐 ai-job-search 的 drafter-reviewer：先起草，再以招聘方视角自检，修订后才可交付）。

输入：职业画像 / 经历补充材料 / 目标岗位 JD / 上一轮草稿（含结构化简历文档 resume 与 JD 要点清单 jdPoints）。

任务：逐字段审阅草稿，仅对「需要改进」的字段输出修订值；某字段无需修改就输出 null（缺省代表保留草稿）。审阅维度：
1. **诚实性红线（最优先，逐条核对 source）**：resume 里每条 bullet 的 text 是否超出了同一条 source 能支撑的范围？education/internships/works/projects 的 heading、meta 是否与原文一致（公司/职位/在职时长、学校/学历/专业、时间不得改动或美化）？是否存在 source 为空、却写了具体事实的条目？是否存在虚构证书/奖项/数字/比例/金额/用户量/时长、或承诺薪资/到岗/面试时间？**触犯任一条必须在 resume 中修订或删除该条**，绝不保留。
2. ATS 关键词覆盖：关键词仅可表达原文已确认的能力，不能用同领域经历推导新能力。逐句审阅摘要、面板亮点与求职信，删除只有项目技术栈、画像推导或JD能支持的个人实现/熟练程度声明。未知能力归入缺口，不为匹配度补造。
3. 结构与可排版性：resume 模块齐全且**没有编造出来的空壳模块**（没内容的模块必须是空数组/空对象，不得出现「暂无」「待补充」等占位文字）；projects 只保留按 JD 相关性排序的最多 3 个项目，每项最多 3 条要点，事实不足时不凑数；bullets 每条建议 40-70 字、不得超过 80 字。skills 合并同义项，最多 4 组，同一技能不跨组重复；技术栈放 meta，经历要点写具体贡献。
4. 精简与证据：tailoredSummary 与 resume.selfEval.text 为同一段 60-90 字简介，开头点明身份，删除重复技能清单和无事例自评；tailoredExperiences 2-4 条、一条不超过 80 字。没有明确测试口径或用户/业务数据时，删除「毫秒级响应」「显著提升使用粘性」「大幅提升效率」等效果词，即使原文有这些笼统说法也只保留具体功能与实现。量化只提炼有证据的原始数字，严禁编造或推算。
5. 求职信口吻：coverLetter 必须求职者第一人称（前10字优先展示真实相关经验），全文 120-250 字（含标点，建议约 150 字，与 greetings.ts::GREETING_LENGTH_RULE 同口径）、单行不换行；项目亮点必须精炼（只挑 1-2 个与岗位最相关的真实项目/技能、禁止罗列技术栈清单）；严禁招聘方口吻（「看到你的简历」「你的经历很匹配我们」「欢迎进一步沟通」「我们团队」「候选人」等），不得承诺薪资、到岗时间、面试时间。**校名披露（只约束 coverLetter，简历正文 resume 中的学校名照抄原文不受此限）**：${schoolRule ? schoolRule.trim() : '院校名称只有简历院校属于 985/211 时才允许写出，其余院校一律不出现任何院校名称或层级字样，只写学历/专业/年级。'}
6. 建议可执行性：suggestions 3-5 条、基于简历与 JD 的真实差距、每条不超过 40 字。
7. **能力描述语保真（重点复查项）**：逐条比对 resume.skills 与各模块 bullet 的 text / 同条 source，**原文中的「精通 / 熟练 / 熟悉 / 掌握 / 擅长 / 了解 / 具备…能力 / 沉淀」等描述语是否被保留**？凡是「原文有描述语、text 里却压成了无修饰的技能罗列」（如 source「前端：熟悉 React、TypeScript，沉淀通用组件库」被改成 text「前端：React、TypeScript、通用组件库」），**必须在 resume 中把描述语按 source 原文补回**（可同义替换，不得升级为「精通」），并在 reviewNote 里说明补回了哪几条；同时检查有没有反向错误——把原文的「了解」写成「精通」这类**凭空升级**，也要改回原文强度。

${PROJECT_WRITING_RULE}
按上述项目表达规则逐条回查：保留项目性质和本人职责，补回被压掉但有source支撑的业务链路、验证或交付细节；删除无实施依据的部署、客户、指标或故障故事。资料不足时只提出具体建议，不新增事实。

保留草稿 jdPoints 的要点名称、层级、顺序和权重，不增删要点；必须逐项重新核对合并本轮修订后的最终 resume，并返回完整 jdPoints（只更新 verdict/evidence）。已在最终正文写明的能力标为 covered，依据引用最终正文；仅在补充里存在而未写入正文才是 addable。用户明确提供的「了解」技能可如实写入 skills，不强求项目细节；不得升级水平或编造项目经历。纯愿望、否定或到岗/工作时间意向未经本人明确确认时，不能视为具备。
用同一套标准返回 matchScore：before 评估原始资料与有效补充，after 必须评估合并本轮修订后的最终简历文档。不能沿用修订前分数，也不能因目标100分而抬高分数；未修订正文时可以沿用草稿评分。

【输出 schema】只输出以下字段（字段名与类型不可变更；无需修订的字段一律输出 null）：
${TAILOR_REVIEW_SCHEMA}

【输出样例】（null 表示该字段无需修订、保留草稿；仅示意写法，实际判断须基于草稿内容）：
${TAILOR_REVIEW_OUTPUT_EXAMPLE}

只输出一个 json 对象，不要解释、不要代码块围栏。`;
}

// ===== 口吻校验（复用打招呼口径，保证与现有投递链路一致） =====
function isApplicantVoice(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const reversed = /看到你的简历|你的简历|很匹配我们|匹配我们|欢迎.*进一步沟通|期待你加入我们|候选人|我们团队|我们公司|我们这边|团队主要涉及|你很匹配|方便的话来聊聊|期待与你/i.test(raw);
  const applicantVoice = /我想应聘|我希望应聘|我(?:做过|参与|完成|写过|实践|是|有|独立)|我对.{0,30}(岗位|职位|这份|这个|该).{0,15}(感兴趣|有兴趣)|想进一步了解|希望进一步沟通|希望和您(聊聊|沟通|交流)|希望加入|对该.{0,10}感兴趣|期望加入|期待加入|期待.{0,5}交流|可实习|可到岗|您好/i.test(raw);
  return !reversed && applicantVoice;
}

/** 定制结果中的匹配分析（本地确定性兜底计算；AI 可用时以 aiMatch 为准） */
export interface TailorMatchAnalysis {
  /** JD 关键词三层比对（本地兜底展示用） */
  keywords: JdKeywordAnalysis;
  /** 定制前匹配分（基于简历原文 + 画像） */
  before: MatchScore;
  /** 本地兜底不再提供可比对的「定制后分」（口径不同会误导），恒等于 before */
  after: MatchScore;
}

/** 第二轮回审（Reviewer）结论：只保留一行结论与本次被修订的字段名 */
export interface TailorReviewMeta {
  /** 复检结论（一行） */
  note?: string;
  /** 被修订的字段中文名 */
  revisedFields: string[];
}

export interface TailorResult {
  resumeSource?: import('./resumeVariants').ResumeSourceSnapshot;
  writingPreferences?: ResumeWritingPreferences;
  /** 随历史快照保存的多轮补充；老记录没有此字段。 */
  supplements?: TailorSupplement[];
  /** 上一版定制后 AI 分，用于比较本轮补充的实际效果。 */
  previousScore?: number | null;
  /** 岗位要求且简历具备的技能 */
  highlightedSkills: string[];
  /** 针对岗位定制的个人摘要 */
  tailoredSummary: string;
  /** 按岗位相关性重排的经历要点（允许量化改写，仅提炼简历已有数字） */
  tailoredExperiences: string[];
  /** 定制求职信（第一人称打招呼语） */
  coverLetter: string;
  /** 岗位要求但简历缺失的技能/经验（如实呈现，不补写） */
  skillGaps: string[];
  /** 可执行的优化建议（AI 生成，失败回退本地规则） */
  suggestions: string[];
  /** 结构化简历文档（七模块）：PDF 排版的事实来源 */
  doc: TailorResumeDoc;
  /** JD 要点对照清单（AI 分层 + 三层判定 + 依据） */
  jdPoints: TailorJdPoint[];
  /** AI 同口径匹配度；null = AI 不可用，界面回退本地估算（不作前后对比） */
  aiMatch: TailorAiMatch | null;
  /** 逐条改写对照（由 doc 的 source/text 派生，与最终交付稿永远同步） */
  rewrites: TailorRewrite[];
  /**
   * 描述语丢失告警（确定性检出）：把原文里「精通/熟练/熟悉/…」等能力描述语抹平的改写条目。
   * 提示词已要求保真，这里是兜底——真丢了就在界面上如实标出来，便于人工补回。
   */
  qualifierLoss: QualifierLoss[];
  /** 匹配分析（本地确定性计算，仅 AI 不可用时作兜底展示） */
  match: TailorMatchAnalysis;
  /** 第二轮回审（Reviewer）结论（有修订或结论时才有） */
  review?: TailorReviewMeta;
  method: 'ai' | 'local';
  warning?: string;
}

// ===== 文档解析与派生 =====

const lineText = (v: unknown): string => String(v ?? '').trim();

/** 规范化一个块（教育/实习/工作/项目）：heading/meta/bullets(含 source) */
function normalizeBlocks(raw: unknown, maxBlocks: number, maxBullets = 6): TailorDocBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: TailorDocBlock[] = [];
  for (const item of raw.slice(0, maxBlocks)) {
    const heading = lineText((item as any)?.heading || (item as any)?.title || (item as any)?.name);
    const meta = lineText((item as any)?.meta);
    const bullets: TailorDocLine[] = [];
    const rawBullets = Array.isArray((item as any)?.bullets) ? (item as any).bullets : [];
    for (const b of rawBullets.slice(0, maxBullets)) {
      const text = lineText(typeof b === 'string' ? b : b?.text);
      if (!text) continue;
      // 字符串形式的 bullet（模型偶尔返回纯文本）视为无 source，界面会标为需人工核对
      const source = lineText(typeof b === 'string' ? '' : b?.source);
      bullets.push({ text, source });
    }
    if (!heading && !meta && !bullets.length) continue;
    out.push({ heading, meta, bullets });
  }
  return out;
}

/** 规范化 { text, source } 行列表（专业技能） */
function normalizeLines(raw: unknown, max: number): TailorDocLine[] {
  if (!Array.isArray(raw)) return [];
  const out: TailorDocLine[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = lineText(typeof item === 'string' ? item : item?.text);
    if (!text) continue;
    const key = text.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const source = lineText(typeof item === 'string' ? '' : item?.source);
    out.push({ text, source });
    if (out.length >= max) break;
  }
  return out;
}

/** 把 AI 返回的 resume 规范化（缺字段/类型错一律回落空，绝不让脏数据进 PDF） */
export function normalizeTailorDoc(raw: unknown): TailorResumeDoc {
  const r: any = raw || {};
  return {
    education: normalizeBlocks(r.education, 3),
    internships: normalizeBlocks(r.internships, 4, 3),
    works: normalizeBlocks(r.works, 4, 3),
    projects: normalizeBlocks(r.projects, 3, 3),
    skills: normalizeLines(r.skills, 4),
    honors: normalizeStringList(r.honors, 8),
    selfEval: {
      text: lineText(r.selfEval?.text ?? (typeof r.selfEval === 'string' ? r.selfEval : '')),
      source: lineText(r.selfEval?.source),
    },
  };
}

const JD_LAYERS: JdPointLayer[] = ['must', 'prefer', 'duty', 'team'];
const JD_VERDICTS: JdPointVerdict[] = ['covered', 'addable', 'missing'];

export function normalizeJdPoints(raw: unknown, max = 20): TailorJdPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: TailorJdPoint[] = [];
  for (const item of raw.slice(0, max)) {
    const point = lineText((item as any)?.point).slice(0, 24);
    if (!point) continue;
    const layer = JD_LAYERS.includes((item as any)?.layer) ? ((item as any).layer as JdPointLayer) : 'duty';
    const verdict = JD_VERDICTS.includes((item as any)?.verdict) ? ((item as any).verdict as JdPointVerdict) : 'missing';
    out.push({ point, layer, verdict, evidence: lineText((item as any)?.evidence).slice(0, 60) });
  }
  return out;
}

/** 夹取 0-100 整数分 */
const clampScore = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
};

export function normalizeAiMatch(raw: unknown): TailorAiMatch | null {
  const r: any = raw || {};
  const before = r.before ?? r.beforeScore;
  const after = r.after ?? r.afterScore;
  if (before == null || after == null) return null;
  if (!Number.isFinite(Number(before)) || !Number.isFinite(Number(after))) return null;
  return { before: clampScore(before), after: clampScore(after) };
}

/** 归一化文本（去空白/标点差异）用于判断「是否真的改写过」 */
const normForCompare = (s: string): string =>
  String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、,.;:!?！？"'“”‘’（）()【】\[\]·\-—~～]/g, '')
    .toLowerCase();

/** 清单身份与顺序保持不变，复检只更新同一要点的结论；正文改变后不静默沿用旧结论。 */
export function finalizeJdPoints(
  draft: TailorJdPoint[], reviewed: unknown, doc: TailorResumeDoc, docChanged: boolean,
): TailorJdPoint[] {
  const key = (p: TailorJdPoint) => `${p.layer}:${normForCompare(p.point)}`;
  const updates = new Map<string, TailorJdPoint>();
  const duplicates = new Set<string>();
  if (Array.isArray(reviewed)) for (const raw of reviewed) {
    if (!raw || !JD_LAYERS.includes(raw.layer) || !JD_VERDICTS.includes(raw.verdict)
      || typeof raw.point !== 'string' || typeof raw.evidence !== 'string' || !raw.evidence.trim()) continue;
    const point = normalizeJdPoints([raw])[0];
    if (!point) continue;
    const id = key(point);
    if (updates.has(id)) duplicates.add(id);
    updates.set(id, point);
  }
  const bodyLines = [
    ...doc.skills.map((line) => line.text), doc.selfEval.text,
    ...[...doc.education, ...doc.internships, ...doc.works, ...doc.projects]
      .flatMap((block) => [block.heading, block.meta, ...block.bullets.map((line) => line.text)]),
    ...doc.honors,
  ];
  return draft.map((point) => {
    const id = key(point);
    const update = duplicates.has(id) ? undefined : updates.get(id);
    // 明确的技能表述已出现在最终正文时，即使模型仍返回旧 addable，也可直接核对纠正。
    // 只处理有能力水平前缀的完整字面匹配，不把 SQL/MySQL 提及外推为表设计或复合硬条件。
    const normalizedPoint = normForCompare(point.point);
    const direct = /^(了解|熟悉|熟练|掌握|精通|擅长)/.test(normalizedPoint)
      ? bodyLines.flatMap((line) => line.split(/[，。；;、\n]/)).find((line) => {
        const normalized = normForCompare(line);
        const index = normalized.indexOf(normalizedPoint);
        if (index < 0) return false;
        return !/(不|未|没有|缺乏|希望|计划|准备|目标|待学习)/.test(normalized);
      }) : undefined;
    if (direct) return { ...point, verdict: 'covered', evidence: `最终正文：${direct.trim()}`.slice(0, 60), statusVerified: true };
    if (update) return { ...point, verdict: update.verdict, evidence: update.evidence, statusVerified: true };
    if (!docChanged) return { ...point, statusVerified: true };
    return { ...point, evidence: '最终正文已修改，该要点未获得有效复核，请点击复核要点。', statusVerified: false };
  });
}

/** 只复核已经交付的正文，绝不把复核响应中的新正文或经历写回简历。 */
export async function recheckTailorResult(input: {
  result: TailorResult; job: JobMeta; resumeText: string; profile: Profile | null;
  model: AppConfig['model']; extraMaterials?: string;
}): Promise<TailorResult> {
  const { result, job, model } = input;
  const resumeText = result.resumeSource?.text ?? input.resumeText;
  const profile = result.resumeSource ? result.resumeSource.profile : input.profile;
  if (!model?.apiKey) throw new Error('请先在设置中配置 AI');
  if (!result.jdPoints.length) throw new Error('当前结果没有可复核的岗位要点');
  const system = `你是简历最终正文复核员。只核对已有正文，禁止改写简历、求职信或增加要点。
事实来源仅限简历原文、本人导入材料及已确认的用户补充；画像仅供理解。岗位要求、教程、上一版AI正文不是新增经历依据。保留补充中的否定、纠错与编辑要求，愿望不能当作已具备事实，了解不能升级成熟练。
逐条返回原有 id，不得遗漏、重复或改名。covered=真实事实已在最终正文体现且满足要求；addable=事实来源支持但最终正文未体现；missing=事实来源不足或不满足要求。不能只因出现关键词就判为covered，复合条件须全部满足。团队环境只判断适配，不写成求职者经历。
evidence必须说明最终正文中的对应内容或真实缺口，不能沿用旧判定。评分同口径比较原简历与最终正文，0到100分，不因补充或重试强制加分。
每个covered须返回factQuotes和bodyQuotes：factQuotes逐字摘录本人原始资料中支持全部要求的原文，bodyQuotes逐字摘录最终正文中的对应句子。addable须返回有效factQuotes；missing可返回空数组。两组引文不能互相冒充，画像、JD、AI草稿不可放进factQuotes。引文可以多条，每条应完整表达所证明的事实，不能只给关键词。
特别核查：RAG/API不证明Embedding、提示词或算法研发；课程/毕业年份不证明一年研究；参与设计、测试及项目覆盖后端不证明本人实现接口；在校不证明每周天数或实习月份。具体时长和复合条件须有对应证据，不足时判missing。
技能清单和使用经历不自动证明熟练程度；MySQL不等于SQL语法。不同项目的API集成与页面验证不能拼成模型API测试；检测效果验证不证明已记录误报漏报，数据标注不证明数据清洗，机器学习不自动证明数据挖掘。问题分析与解决须在正文体现具体排查/定位/调试/修复动作。
${PROJECT_WRITING_RULE}
只返回JSON：{"jdPoints":[{"id":"p1","verdict":"covered|addable|missing","evidence":"具体依据，60字以内","factQuotes":[],"bodyQuotes":[]}],"matchScore":{"before":60,"after":72}}`;
  const body = JSON.stringify({
    education: result.doc.education, internships: result.doc.internships, works: result.doc.works,
    projects: result.doc.projects, skills: result.doc.skills, honors: result.doc.honors, selfEval: result.doc.selfEval,
  }, (key, value) => key === 'source' ? undefined : value);
  const points = JSON.stringify(result.jdPoints.map((p, i) => ({ id: `p${i + 1}`, point: p.point, layer: p.layer })));
  // 保留最终正文和完整清单；仅为事实材料分配剩余窗口，不裁坏 JSON。
  const available = resolveContextBudget(model, { outputTokens: 6144 }).inputBudgetTokens
    - estimateTokens(system + body + points) - 1000;
  if (available < 1500) throw new Error('当前模型窗口不足以完整复核，请增大上下文窗口');
  const facts = await prepareContextText(String(resumeText || ''), model, {
    tokenBudget: Math.floor(available * 0.45), cacheScope: 'assistant', purpose: '定制简历-最终正文复核事实',
    focus: '保留求职者真实教育、项目、技能、职责与成果，保留能力水平、否定、具体名称与数字',
  });
  const supplemental = [input.extraMaterials || '', ...(result.supplements || []).map((s, i) => `【第${i + 1}轮用户补充】\n${s.text}`)].filter(Boolean).join('\n\n');
  const extra = supplemental ? (await prepareContextText(supplemental, model, {
    tokenBudget: Math.floor(available * 0.25), cacheScope: 'assistant', purpose: '定制简历-最终正文复核补充', mode: 'transform',
    focus: '按顺序保留事实、否定、纠错和编辑要求，区分事实和愿望',
    instruction: '保留各轮顺序和纠错、否定；编辑要求和愿望不能转换成已具备的事实。',
  })).text : '';
  // 复核响应还需业务校验；不复用未通过校验的缓存，确保点击重试能再次请求。
  const response: any = await cachedCallModel([
    { role: 'system', content: system },
    { role: 'user', content: `简历原文：${facts.text}\n本人材料与已确认补充：${extra}\n画像（仅参考）：${fitContextToTokens(profile ? JSON.stringify(stableProfileView(profile)) : '', Math.floor(available * 0.1))}\n岗位：${JSON.stringify({ title: job.title, company: job.company, description: fitContextToTokens(job.description || '', Math.floor(available * 0.2)) })}\n最终正文（只读）：${body}\n原有要点：${points}` },
  ], model, { maxTokens: 6144, temperature: 0.1 }, { scope: 'assistant', ttlMs: 0 });
  const assessed = response?.jdPoints;
  const score = response?.matchScore;
  const validScore = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))
    && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  const aiMatch = validScore(score?.before ?? score?.beforeScore) && validScore(score?.after ?? score?.afterScore)
    ? normalizeAiMatch(score) : null;
  if (!Array.isArray(assessed) || assessed.length !== result.jdPoints.length || !aiMatch) {
    throw new Error('AI 未返回完整的要点判定与评分，已有简历已保留，请重试复核');
  }
  const updates = new Map<string, { verdict: JdPointVerdict; evidence: string; factQuotes: string[]; bodyQuotes: string[] }>();
  const originalFacts = [resumeText, input.extraMaterials || '', ...(result.supplements || []).map(s => s.text)].join('\n');
  const finalBody = resumeBodyText(result.doc);
  let verdictCorrected = false;
  for (const p of assessed) {
    if (typeof p?.id !== 'string' || !/^p[1-9]\d*$/.test(p.id) || Number(p.id.slice(1)) > result.jdPoints.length
      || updates.has(p.id) || !JD_VERDICTS.includes(p.verdict) || typeof p.evidence !== 'string' || !p.evidence.trim()) {
      throw new Error('AI 复核要点不完整或格式无效，已有简历已保留，请重试复核');
    }
    const factQuotes = normalizeStringList(p.factQuotes, 8);
    const bodyQuotes = normalizeStringList(p.bodyQuotes, 8);
    const point = result.jdPoints[Number(p.id.slice(1)) - 1];
    const validFacts = factQuotes.length > 0 && factQuotes.every(q => hasFactQuote(q, originalFacts));
    const validBody = bodyQuotes.length > 0 && bodyQuotes.every(q => hasFactQuote(q, finalBody));
    let verdict: JdPointVerdict = p.verdict;
    let evidence = p.evidence.trim();
    if ((verdict === 'covered' || verdict === 'addable') && (!validFacts || !pointProofIsSpecific(point.point, factQuotes))) {
      verdict = 'missing';
      evidence = '本人原始资料未提供满足该要点的具体证据，需确认后补充。';
    } else if (verdict === 'covered' && (!validBody || !pointProofIsSpecific(point.point, bodyQuotes))) {
      verdict = 'addable';
      evidence = '原始资料有依据，但最终正文未完整体现该要求。';
    }
    if (verdict !== p.verdict) verdictCorrected = true;
    updates.set(p.id, { verdict, evidence, factQuotes: validFacts ? factQuotes : [], bodyQuotes: validBody ? bodyQuotes : [] });
  }
  if (result.jdPoints.some((_, i) => !updates.has(`p${i + 1}`))) {
    throw new Error('AI 遗漏了要点判定，已有简历已保留，请重试复核');
  }
  return {
    ...result,
    jdPoints: result.jdPoints.map((p, i) => ({ ...p, ...updates.get(`p${i + 1}`)!, statusVerified: true })),
    aiMatch: verdictCorrected ? null : aiMatch,
    warning: verdictCorrected ? '已按原始证据纠正部分要点，未采纳基于原判定的 AI 匹配分。'
      : /^(复检修改了正文但未返回有效评分|最终正文复核尚未完成|已按原始证据纠正部分要点)/.test(result.warning || '') ? undefined : result.warning,
  };
}

export interface TailorRewriteResult {
  rewrites: TailorRewrite[];
  /** 定制后条目里找不到原文对应的（界面标为需人工核对，属于潜在的编造风险点） */
  unmatched: TailorRewrite[];
}

/**
 * 由文档里的 source/text 派生「原文 → 定制后」逐条对照：
 *   - source 为空 → 无原文对应，进 unmatched（界面提示需人工核对）；
 *   - source 与 text 归一化后一致 → 未改写，不列入对照；
 *   - 其余 → 一条改写对照，并按原文出现位置判断来源（补充材料 / 简历原文）。
 */
export function deriveRewrites(
  doc: TailorResumeDoc,
  moduleOf: Record<string, string>,
  extraText = ''
): TailorRewriteResult {
  const rewrites: TailorRewrite[] = [];
  const unmatched: TailorRewrite[] = [];
  const extraBlob = normForCompare(extraText);
  const push = (module: string, line: TailorDocLine) => {
    const after = lineText(line.text);
    const before = lineText(line.source);
    if (!after) return;
    if (!before) {
      unmatched.push({ module, after, before: '', from: 'none' });
      return;
    }
    if (normForCompare(after) === normForCompare(before)) return;
    const src = normForCompare(before);
    const from: TailorRewrite['from'] = extraBlob && src && extraBlob.includes(src) ? 'extra' : 'resume';
    rewrites.push({ module, after, before, from });
  };
  const walk = (key: string, blocks: TailorDocBlock[]) => {
    const module = moduleOf[key] || key;
    for (const b of blocks) for (const bullet of b.bullets) push(module, bullet);
  };
  walk('internships', doc.internships);
  walk('works', doc.works);
  walk('projects', doc.projects);
  for (const line of doc.skills) push(moduleOf.skills || '专业技能', line);
  push(moduleOf.selfEval || '自我评价', doc.selfEval);
  return { rewrites, unmatched };
}

/**
 * 能力描述语及其水平强度：数字越大越强；0 = 非水平类（只判断有无，如「沉淀/具备」）。
 * 用于区分「同义替换/升级」（可接受）与「降级/抹平」（必须报出来）。
 */
const QUALIFIER_LEVELS: Record<string, number> = {
  了解: 1,
  会用: 1,
  熟悉: 2,
  掌握: 2,
  沉淀: 0,
  具备: 0,
  能独立: 0,
  可独立: 0,
  熟练: 3,
  擅长: 3,
  精通: 4,
};
const PROFICIENCY_WORDS_RE = new RegExp(Object.keys(QUALIFIER_LEVELS).join('|'), 'g');

/** 文本中出现过的最高描述语强度（0 = 无水平类描述语） */
function maxQualifierLevel(text: string): number {
  const hits = text.match(PROFICIENCY_WORDS_RE) || [];
  return hits.reduce((max, w) => Math.max(max, QUALIFIER_LEVELS[w] ?? 0), 0);
}

/** 一条「描述语被抹平或降级」的改写 */
export interface QualifierLoss {
  /** 所属模块中文名 */
  module: string;
  /** 原简历原文 */
  before: string;
  /** 定制后内容 */
  after: string;
  /** 丢失或降级的描述语 */
  words: string[];
}

/**
 * 确定性检出「描述语失真」：原文含能力描述语，而定制后**该描述语既不在、也没有被同级或更强的描述语替换**。
 * 判定口径：
 *   - 原词仍在 → 不算失真；
 *   - 被同级/更强描述语替换（熟悉→掌握、熟悉→精通）→ 不算失真（同义替换/合理升级）；
 *   - 被降级（熟练→熟悉）或直接抹平（「熟悉 X、沉淀 Y」压成「X、Y」）→ 算失真。
 * 用途：提示词已要求保真，但模型仍可能压平——这里如实检出并在界面提示，
 * **不做自动回填**（回填需要重新措辞，交给 AI 复检或人工，避免本地拼出不通顺的句子）。
 */
export function findQualifierLoss(rewrites: TailorRewrite[]): QualifierLoss[] {
  const out: QualifierLoss[] = [];
  for (const r of rewrites) {
    if (!r.before || !r.after) continue;
    const hits = r.before.match(PROFICIENCY_WORDS_RE);
    if (!hits || !hits.length) continue;
    const afterPeak = maxQualifierLevel(r.after);
    const lost = [...new Set(hits)].filter((w) => {
      if (r.after.includes(w)) return false;
      const level = QUALIFIER_LEVELS[w] ?? 0;
      if (level > 0 && afterPeak >= level) return false;
      return true;
    });
    if (lost.length) out.push({ module: r.module, before: r.before, after: r.after, words: lost });
  }
  return out;
}

/** 模块中文名（对照展示用） */
export const RESUME_DOC_MODULE_LABEL: Record<string, string> = {
  education: '教育经历',
  internships: '实习经历',
  works: '工作经历',
  projects: '项目经历',
  skills: '专业技能',
  honors: '个人荣誉',
  selfEval: '自我评价',
};

/** 本地兜底：用职业画像 facts 拼一份结构化文档（AI 不可用时保证 PDF 仍可用） */
export function buildLocalTailorDoc(profile: Profile | null): TailorResumeDoc {
  const facts = profile?.facts;
  const blocksOf = (items: string[] | undefined): TailorDocBlock[] =>
    (items || [])
      .filter(Boolean)
      .slice(0, 4)
      .map((s) => {
        const lines = String(s).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const hasMeta = lines.length > 1 && /\d{4}|技术栈|课程设计|竞赛项目|个人技术实践|开源二次开发|原型实践/.test(lines[1]);
        return { heading: lines[0] || '', meta: hasMeta ? lines[1] : '', bullets: lines.slice(hasMeta ? 2 : 1).map(text => ({ text, source: text })) };
      });
  return {
    education: blocksOf(facts?.education),
    internships: blocksOf(facts?.experiences),
    works: [],
    projects: blocksOf(facts?.projects),
    skills: (facts?.skills || []).slice(0, 12).map((s) => ({ text: String(s), source: String(s) })),
    honors: (facts?.certificates || []).slice(0, 8).map((s) => String(s)),
    selfEval: { text: String(profile?.summary || '').trim(), source: String(profile?.summary || '').trim() },
  };
}

/**
 * 根据岗位 JD 生成定制简历（结构化文档 + JD 要点对照 + 同口径匹配分 + 求职信 + 建议）+ 本地确定性匹配兜底。
 * 输入：岗位信息（title/company/salary/location/description）、简历原文、职业画像、AI 模型配置、可选经历补充材料。
 * AI 不可用/输出不达标 → 回退本地规则，绝不外泄未经事实与口吻校验的内容。
 */
export async function tailorForJob(
  job: JobMeta,
  resumeText: string,
  profile: Profile | null,
  model: AppConfig['model'],
  customGreetingPrompt?: string,
  extraMaterials?: string,
  iteration?: TailorIterationInput
): Promise<TailorResult> {
  const resumeSource = JSON.parse(JSON.stringify(iteration?.resumeSource || {
    name: '原简历', text: resumeText, profile, writingPreferences: iteration?.writingPreferences || {},
  })) as import('./resumeVariants').ResumeSourceSnapshot;
  resumeText = resumeSource.text;
  profile = resumeSource.profile;
  // ===== 本地确定性匹配分析（不依赖 AI；仅作 AI 不可用时的兜底展示） =====
  const { keywords, weights } = extractJdKeywords(job.description || '', profile);
  const keywordAnalysis = analyzeJdKeywords(job.description || '', resumeText, profile, keywords);
  const profileBlob = profile ? JSON.stringify(stableProfileView(profile)) : '';
  const beforeScore = computeMatchScore(keywords, weights, `${resumeText}\n${profileBlob}`);

  const extra = String(extraMaterials || '').trim();
  const writingPreferences = resumeSource.writingPreferences;
  const preferenceInstructions = resumePreferenceRule(writingPreferences);
  const supplements = (iteration?.supplements || []).filter((s) => s.text?.trim());
  const supplementText = supplements.map((s, i) => `【第${i + 1}轮用户补充】\n${s.text}`).join('\n\n');

  const buildMatch = (): TailorMatchAnalysis => ({
    keywords: keywordAnalysis,
    before: beforeScore,
    // 本地算法不再产出「定制后分」：AI 两次判分的口径不可比，旧实现（原简历+定制内容拼接重算）
    // 会让前后恒等、给出「定制无增益」的假象。这里恒等于 before，界面据此标注为「本地估算」。
    after: beforeScore,
  });

  const localFallback = (warning: string): TailorResult => {
    const doc = enforceResumeFacts(buildLocalTailorDoc(profile), [resumeText, extra, supplementText].filter(Boolean).join('\n\n'), writingPreferences).doc;
    return {
      resumeSource,
      highlightedSkills: doc.skills.map(line => line.text),
      tailoredSummary: doc.selfEval.text,
      tailoredExperiences: doc.projects.map(block => `${block.heading}：${block.bullets[0]?.text || block.meta}`),
      coverLetter: fallbackApplicantGreeting(job, profile, resumeText),
      skillGaps: [],
      suggestions: buildLocalSuggestions(keywordAnalysis, job.description || '', resumeHasQuantifiedEvidence(resumeText)),
      doc,
      jdPoints: [],
      aiMatch: null,
      rewrites: [],
      qualifierLoss: [],
      match: buildMatch(),
      method: 'local',
      writingPreferences,
      supplements,
      warning,
    };
  };
  if (!profile) return localFallback('尚未生成职业画像，当前为本地规则生成的定制内容。');
  if (!model?.apiKey) return localFallback('AI 尚未配置，当前为本地规则生成的定制内容。');

  // ===== 上下文预算（唯一口径见 contextBudget.ts）=====
  // 简历、导入材料、画像、岗位描述，以及迭代时的用户补充和上一版共享输入预算。
  // 旧实现是各自硬编码字面量（简历 6000 字、补充材料 4000 字、岗位描述不裁），
  // 结果是「1M 窗口的模型只吃 6000 字简历」，而小窗口模型仍可能被长 JD 顶穿。
  // 现改为由用户在设置页声明的窗口大小与用量档位（全满 / 40%）统一决定。
  // 第一轮（草稿）与第二轮（复检）共用同一份裁剪结果：口径一致，也保证两轮看到的上下文相同。
  const ctxBudget = allocateContextBudget(
    model,
    supplementText
      ? { resume: 0.35, extra: 0.15, profile: 0.1, job: 0.15, supplement: 0.15, previous: 0.1 }
      : { resume: 0.45, extra: 0.2, profile: 0.15, job: 0.2, supplement: 0, previous: 0 },
    { outputTokens: 4096 },
  );
  // 简历与经历补充材料是「定制内容的事实来源」：超预算时分片提炼（≤3 片）后合并，
  // 不静默丢弃后半段经历（见 oversizedContext.ts）——定制简历的每条内容都必须能溯源到真实原文。
  const resumeCtx = (
    await prepareContextText(String(resumeText || ''), model, {
      tokenBudget: ctxBudget.resume,
      focus: '与目标岗位定制相关的简历真实事实：教育背景、实习/工作经历、项目经历、技能栈、证书荣誉（保留具体名称与数字）',
      cacheScope: 'assistant',
      purpose: '定制简历-简历上下文',
    })
  ).text;
  const extraCtx = extra
    ? (
        await prepareContextText(extra, model, {
          tokenBudget: ctxBudget.extra,
          focus: '求职者补充提供的真实经历材料（项目细节、成果、职责），与简历原文同为事实来源',
          cacheScope: 'assistant',
          purpose: '定制简历-补充材料',
        })
      ).text
    : '';
  const profileCtx = fitContextToTokens(JSON.stringify(stableProfileView(profile)), ctxBudget.profile);
  const supplementCtx = supplementText ? (await prepareContextText(supplementText, model, {
    tokenBudget: ctxBudget.supplement,
    focus: '按顺序保留本人明确提供的事实、纠错、否定与编辑要求，区分事实和愿望，不把指令当经历',
    cacheScope: 'assistant', purpose: '定制简历-多轮补充', mode: 'transform',
    instruction: '整理用户多轮补充，保留各轮的事实、纠错、否定和编辑要求及其先后关系，明确区分事实与愿望；禁止把希望具备的技能、提高分数的指令改写为已具备的经历或成果。',
  })).text : '';
  const previous = iteration?.previousResult;
  const previousCtx = previous && supplementText ? fitContextToTokens(JSON.stringify({
    resume: previous.doc, skillGaps: previous.skillGaps, suggestions: previous.suggestions,
    jdPoints: previous.jdPoints, matchScore: previous.aiMatch,
  }), ctxBudget.previous) : '';
  const iterationCtx = supplementCtx ? `\n\n用户多轮补充（事实、纠错与编辑要求须区分）：\n${supplementCtx}${previousCtx ? `\n\n上一版（仅编辑参考，不是事实来源）：\n${previousCtx}` : ''}` : '';
  const jobView = {
    title: job.title,
    company: job.company,
    salary: decodeSalaryDigits(job.salary),
    location: job.location,
    // 只裁 description 值（直接裁 stringify 后的整段 JSON 会把结构切坏）
    description: fitContextToTokens(String(job.description || ''), ctxBudget.job),
  };
  try {
    // 求职信/打招呼语提示词来源优先级：① skill（greetings 技能，含用户自定义技能）→ ② 简历中心输入框内容 → ③ 都不满足则回退本地规则。
    // 每次调用都从磁盘重读 skills/*/SKILL.md（不改文件即无副作用），保证 JD 拆解方法等技能文档改了即时生效。
    await reloadSkills();
    const greetingsSkill = skillInstructionsFor('greetings');
    const greetingInstructions = greetingsSkill || (customGreetingPrompt || '').trim();
    // 校名披露：本地名单裁定后注入（见 schoolTier.ts）——只约束 coverLetter，简历正文按原文照抄不受限
    const schoolTier = resolveSchoolTier(normalizeStringList(profile.facts?.education, 8), resumeText);
    const schoolRule =
      buildSchoolDisclosureRule(schoolTier) +
      '\n（以上「校名披露」规则只约束 coverLetter；简历正文 resume 与 tailoredSummary 中的学校名按简历原文照抄，不受此限。）';
    const coverHasSchoolIssue = (text: string) => !schoolTier.allowSchoolName && hasSchoolMention(text);
    const result: any = await cachedCallModel(
      [
        { role: 'system', content: buildTailorSystemPrompt(greetingInstructions, schoolRule) + skillInstructionsFor('assistant') + '\n' + PROJECT_WRITING_RULE + preferenceInstructions + (supplementCtx ? '\n' + ITERATION_RULE : '') + '\n' + GREETING_PREVIEW_RULE },
        {
          role: 'user',
          content: `职业画像：${profileCtx}
简历：${resumeCtx}${extraCtx ? `\n\n经历补充材料（求职者本人提供，与简历原文同为真实事实来源）：\n${extraCtx}` : ''}
岗位：${JSON.stringify(jobView)}${iterationCtx}`,
        },
      ],
      model,
      { maxTokens: 4096, temperature: 0.3 },
      { scope: 'assistant' }
    );
    const summary = String(result?.tailoredSummary || '').trim();
    const cover = String(result?.coverLetter || '').trim();
    // 事实与口吻校验：摘要非空 + 求职信通过口吻校验 + 校名披露合规（非 985/211 不得出现院校名称）
    if (!summary || !isApplicantVoice(cover) || coverHasSchoolIssue(cover)) {
      return localFallback('AI 生成未通过事实/口吻/校名披露校验，已回退本地规则。');
    }

    // ===== 第一轮：草稿（Draft） =====
    const draftDoc = normalizeTailorDoc(result?.resume);
    const draftPoints = normalizeJdPoints(result?.jdPoints);
    const draftAiMatch = normalizeAiMatch(result?.matchScore);
    const draft = {
      tailoredSummary: summary.slice(0, 300),
      tailoredExperiences: normalizeStringList(result?.tailoredExperiences, 4).map((e) => String(e).slice(0, 90)),
      highlightedSkills: normalizeStringList(result?.highlightedSkills, 8),
      coverLetter: String(cover).trim().replace(/\s+/g, ' '),
      skillGaps: normalizeStringList(result?.skillGaps, 4),
      suggestions: normalizeStringList(result?.suggestions, 5).map((s) => String(s).slice(0, 60)),
      doc: draftDoc,
    };

    // ===== 第二轮：招聘方 + ATS 视角自检修订（Reviewer） =====
    // 对齐 ai-job-search 的 drafter-reviewer。逐字段合并：仅当 review 给出「非空且通过校验」的修订才覆盖，
    // 否则保留草稿；review 失败/无效一律不降级草稿（草稿本身已通过事实与口吻校验）。
    // 注意：复检的「修订差异」不再单独展示（面板统一展示「原文 → 定制后」逐条对照），只保留一行结论与修订字段名。
    let finalDoc = draftDoc;
    let scoreWarning: string | undefined;
    let reviewMeta: TailorReviewMeta | undefined;
    try {
      const review: any = await cachedCallModel(
        [
          { role: 'system', content: buildReviewSystemPrompt(schoolRule) + skillInstructionsFor('assistant') + '\n' + PROJECT_WRITING_RULE + preferenceInstructions + (supplementCtx ? '\n' + ITERATION_RULE : '') + '\n' + GREETING_PREVIEW_RULE },
          {
            role: 'user',
            content: `职业画像：${profileCtx}\n简历原文：${resumeCtx}${extraCtx ? `\n经历补充材料：\n${extraCtx}` : ''}${iterationCtx}
岗位：${JSON.stringify(jobView)}
草稿：${JSON.stringify({
              tailoredSummary: draft.tailoredSummary,
              tailoredExperiences: draft.tailoredExperiences,
              highlightedSkills: draft.highlightedSkills,
              coverLetter: draft.coverLetter,
              skillGaps: draft.skillGaps,
              suggestions: draft.suggestions,
              resume: draft.doc,
              jdPoints: draftPoints,
              matchScore: draftAiMatch,
            })}`,
          },
        ],
        model,
        { maxTokens: 3072, temperature: 0.2 },
        { scope: 'assistant' }
      );
      const reviewerText = (v: unknown) => String(v ?? '').trim();
      const merged = {
        tailoredSummary: reviewerText(review?.tailoredSummary) || draft.tailoredSummary,
        tailoredExperiences:
          Array.isArray(review?.tailoredExperiences) && review.tailoredExperiences.length
            ? normalizeStringList(review.tailoredExperiences, 4).map((e: unknown) => String(e).slice(0, 90))
            : draft.tailoredExperiences,
        highlightedSkills:
          Array.isArray(review?.highlightedSkills) && review.highlightedSkills.length
            ? normalizeStringList(review.highlightedSkills, 8)
            : draft.highlightedSkills,
        coverLetter: (() => {
          const c = reviewerText(review?.coverLetter);
          // 求职信修订须再次通过口吻校验与校名披露校验才采纳，避免 review 把第一人称改坏或把校名塞回来；
          // 只做单行化，长度交由 settle 再生成处理
          return c && isApplicantVoice(c) && !coverHasSchoolIssue(c)
            ? String(c).trim().replace(/\s+/g, ' ')
            : draft.coverLetter;
        })(),
        skillGaps: Array.isArray(review?.skillGaps) ? normalizeStringList(review.skillGaps, 4) : draft.skillGaps,
        suggestions:
          Array.isArray(review?.suggestions) && review.suggestions.length
            ? normalizeStringList(review.suggestions, 5).map((s: unknown) => String(s).slice(0, 60))
            : draft.suggestions,
      };
      // 摘要守卫：review 修订后仍须非空（草稿已验证为非空）
      const finalTailored = { ...merged, tailoredSummary: merged.tailoredSummary.slice(0, 300) || draft.tailoredSummary };
      // 结构化文档：**逐模块合并** —— 仅当 review 返回的对应模块非空时才覆盖草稿，否则保留草稿。
      // （本块上方注释已声明「逐字段合并」，但原实现对 reviewedDoc 整体替换：normalizeTailorDoc 会把
      //   缺失 / 为 null 的模块规范化为空数组，于是 Reviewer 只回填部分模块时，草稿的教育 / 实习 /
      //   工作 / 项目会被整段清空并写进 PDF —— 违反保真红线；且提示词明确「null 表示保留草稿」。）
      const reviewedDoc = review?.resume ? normalizeTailorDoc(review.resume) : null;
      if (reviewedDoc) {
        const keep = <T>(next: T[], prev: T[]): T[] => (next && next.length > 0 ? next : prev);
        finalDoc = {
          education: keep(reviewedDoc.education, finalDoc.education),
          internships: keep(reviewedDoc.internships, finalDoc.internships),
          works: keep(reviewedDoc.works, finalDoc.works),
          projects: keep(reviewedDoc.projects, finalDoc.projects),
          skills: keep(reviewedDoc.skills, finalDoc.skills),
          honors: keep(reviewedDoc.honors, finalDoc.honors),
          selfEval: reviewedDoc.selfEval?.text ? reviewedDoc.selfEval : finalDoc.selfEval,
        };
      }
      const reviewedMatch = normalizeAiMatch(review?.matchScore);
      if (!reviewedMatch && JSON.stringify(finalDoc) !== JSON.stringify(draftDoc)) {
        scoreWarning = '复检修改了正文但未返回有效评分，本次显示本地估算；可重新生成核对匹配度。';
      }
      // 收集实际被修订字段的中文名（面板只展示一行结论，不再展示逐字段 before/after）
      const revisedFields: string[] = [];
      if (finalTailored.tailoredSummary !== draft.tailoredSummary) revisedFields.push('定制个人摘要');
      if (finalTailored.tailoredExperiences.join('；') !== draft.tailoredExperiences.join('；')) revisedFields.push('重点经历');
      if (finalTailored.highlightedSkills.join('；') !== draft.highlightedSkills.join('；')) revisedFields.push('岗位匹配技能');
      if (finalTailored.coverLetter !== draft.coverLetter) revisedFields.push('定制求职信');
      if (finalTailored.skillGaps.join('；') !== draft.skillGaps.join('；')) revisedFields.push('技能缺口');
      if (finalTailored.suggestions.join('；') !== draft.suggestions.join('；')) revisedFields.push('优化建议');
      if (reviewedDoc) revisedFields.push('简历文档');
      const note = reviewerText(review?.reviewNote) || undefined;
      if (note || revisedFields.length) reviewMeta = { note, revisedFields };
      Object.assign(draft, finalTailored);
    } catch {
      /* review 失败不阻塞：沿用草稿 */
    }

    const originalFacts = [resumeText, extra, supplementText].filter(Boolean).join('\n\n');
    finalDoc = await auditResumeFacts(finalDoc, originalFacts, model, writingPreferences);
    const guarded = enforceResumeFacts(finalDoc, originalFacts, writingPreferences);
    finalDoc = guarded.doc;
    // The summary and panel must describe the same grounded facts as the PDF.
    draft.tailoredSummary = finalDoc.selfEval.text;
    draft.highlightedSkills = finalDoc.skills.map(line => line.text);
    draft.tailoredExperiences = finalDoc.projects.map(block => `${block.heading.split('|')[0].trim()}：${block.bullets[0]?.text || block.meta}`);
    if (unsupportedClaim(draft.coverLetter, originalFacts)) {
      const sentences = finalDoc.selfEval.text.match(/[^。！？!?]+[。！？!?]?/g) || [];
      let brief = '';
      for (const sentence of sentences) {
        if (brief && brief.length + sentence.length > 100) break;
        brief += sentence;
      }
      draft.coverLetter = `您好，我想应聘贵公司的${String(job.title || '相关')}岗位。${brief}希望有机会了解贵公司的具体工作内容，并结合岗位要求进一步介绍我参与的项目、实际承担的工作与已有验证记录。我愿意认真学习岗位涉及的业务流程，在明确任务和团队要求后逐步积累实践经验。感谢您阅读，期待进一步交流。`;
    }
    if (writingPreferences.conciseRagLabel) draft.coverLetter = draft.coverLetter.replace(/RAG\s*场\s*景\s*检索/gi, 'RAG');
    if (guarded.corrections.length) reviewMeta = { note: guarded.corrections.join('；'), revisedFields: [...new Set([...(reviewMeta?.revisedFields || []), '事实与表达核对'])] };

    // 逐条改写对照：由最终文档的 source/text 派生，因此永远与交付稿同步
    const { rewrites, unmatched } = deriveRewrites(finalDoc, RESUME_DOC_MODULE_LABEL, [extra, supplementText].filter(Boolean).join('\n\n'));
    const allRewrites = [...rewrites, ...unmatched];
    // 描述语保真兜底检出（只检出、不自动回填；回填措辞交给 AI 复检或人工）
    const qualifierLoss = findQualifierLoss(rewrites);

    const finalResult: TailorResult = {
      ...draft,
      resumeSource,
      writingPreferences,
      doc: finalDoc,
      supplements,
      previousScore: previous?.aiMatch?.after ?? null,
      jdPoints: draftPoints.map(point => ({ ...point, statusVerified: false })),
      aiMatch: null,
      rewrites: allRewrites,
      qualifierLoss,
      review: reviewMeta,
      coverLetter: await settleGreetingLength(draft.coverLetter, {
        job,
        profile,
        resumeText,
        model,
        greetingInstruction: greetingInstructions || DEFAULT_ANALYZE_GREETING_INSTRUCTIONS,
      }),
      match: buildMatch(),
      method: 'ai',
      // AI 首次返回的 JSON 不完整、已由二次补齐修复时，提示（内容仍来自 AI，非降级）
      warning: scoreWarning || ((result as any)?._repaired ? 'AI 首次返回的 JSON 不完整，已通过自动补齐修复（结果仍来自 AI）。' : undefined),
    };
    if (finalResult.jdPoints.length) {
      try {
        return await recheckTailorResult({ result: finalResult, job, resumeText, profile, model, extraMaterials: extra });
      } catch {
        // 补查失败保留最终正文和待复核状态，不能降级或展示旧稿分数。
        return { ...finalResult, warning: '最终正文复核尚未完成，简历内容已保留；请点击「复核要点」重试。' };
      }
    }
    return finalResult;
  } catch (error: any) {
    const kind = aiFailureKind(error);
    const reason =
      kind === 'config-missing' || kind === 'service-error'
        ? `AI 请求${kind === 'config-missing' ? '未配置' : '异常'}，已回退本地规则（${error?.message || '未知原因'}）。`
        : `AI 返回内容解析异常，已回退本地规则（${error?.message || '未知原因'}）。`;
    return localFallback(reason);
  }
}
