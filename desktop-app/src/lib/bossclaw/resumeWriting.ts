/** 定制、回审和逐项续写共用的项目表达口径；写作方法不作为个人事实来源。 */
export const PROJECT_WRITING_RULE = `【项目表达：业务场景、本人贡献与工程细节】
本规则约束所有项目改写与补充；与后续写作技巧或示例冲突时，以本人真实事实和本规则为准。
1. 保留项目性质和本人职责：课程设计、竞赛、个人原型、开源复现/二次开发等性质不改变；用户明确要求隐藏类型标签时可以省略该标签，不得改成企业任职、商业交付或生产上线。区分本人实现、参与集成、复用开源能力与仅做方案设计，不把“参与”升级为“独立负责”。原文说使用AI编程工具辅助时，保留这种贡献边界。
2. 从已有事实中选择与JD最相关的细节：①目标用户和实际业务流程；②本人负责的模块或操作；③输入→处理/接口/工具→输出或存储的技术链路；④测试方法、真实故障与修复验证；⑤实际打包、部署、发布或数据保留方式。每个项目仍遵守最多3条要点和原有字数限制，不强求凑齐五项，不重复堆框架名或“参与开发、完成验证”等空话。
3. AI/RAG项目只写资料明确提供的检索材料、切分/检索、模型或工具调用、API集成、异常处理与验证步骤；没有实施依据时，不能因JD或教程提到就补写向量库、鉴权、MCP、监控、CI/CD、灰度或回滚。其他行业项目同样围绕实际流程、本人动作与可核对结果表达，不硬套技术术语。
4. 交付和验证状态必须准确：本地运行、演示、离线测试、实际试用和生产使用分别表述；方案/计划不能写成已完成，离线测试不能写成线上效果。没有真实数据时写已实现功能和验证动作，不编造企业客户、用户规模、性能、成功率或提升百分比。
5. 每条项目事实都必须由本人原简历或明确确认的经历补充支撑；source摘录对应原文，不把JD、教程、参考视频、写作范例或上一版AI草稿当作本人经历证据。参考材料只借鉴表达方法，不能移植其中的项目、客户或故障故事。
6. 缺少细节时，只输出已有依据的描述；把与当前岗位最相关的缺项写成具体追问，放入suggestions或missingDetails（遵守各字段数量/长度限制），例如本人负责哪个模块、如何验证、实际部署在哪里。只补充“了解”某技能的事实时，可直接保留为技能，不强求虚构项目来证明。不要把问题、待填占位符或计划混入可投递的resume正文。
7. 逐句核对摘要、面板亮点、技能和求职信，不能仅审核项目bullet。项目“覆盖Flask后端”与本人“参与设计、测试”不能写成本人开发后端或实现接口；用数据库不能推出表设计；接入大模型API不能推出提示词工程、Embedding或算法研发；修过课程不能推断研究时长。source须支撑句子的全部事实，不能用仅证明身份的一句原文支撑技术贡献。
8. 原文没有水平描述时，保留中性“使用过/接触/实践”或技能名称，不自动加熟悉、掌握、熟练。原文有水平时不得升降级。跨项目摘要要明确对应关系，不能把相册的MySQL写成台球室的数据库。
9. 岗位匹配技能与最终正文必须来自同一组已确认事实；删去正文中没有依据的能力时同步删去面板亮点与求职信中的对应能力。既有AI画像的推导能力仅供方向参考，不能作为本人实现、职责、时长或熟练程度的原始证据。`;

export interface ResumeWritingPreferences {
  omitCourseList?: boolean;
  omitPatentPreparation?: boolean;
  conciseRagLabel?: boolean;
  separateDevTools?: boolean;
  hideCourseDesignLabel?: boolean;
  preferTwoProjectsWithExperience?: boolean;
}

/** Presentation only: keep the factual project origin without printing this label. */
export function resumeDisplayText(text: string, preferences: ResumeWritingPreferences = {}): string {
  if (!preferences.hideCourseDesignLabel) return text;
  return text.replace(/\s*[|｜·]\s*课程设计\s*(?=[|｜·]|$)/g, '').replace(/课程设计\s*[|｜·]\s*/g, '').replace(/课程设计/g, '').trim();
}

export function resumePreferenceRule(preferences: ResumeWritingPreferences = {}): string {
  const rules = [
    preferences.omitCourseList && '不输出相关课程列表；保留课程设计项目性质，不能因删除课程列表而删除课程项目标签。',
    preferences.omitPatentPreparation && '不输出专利申请前评估材料准备或专利材料实践句。',
    preferences.conciseRagLabel && 'RAG 技能统一写作 RAG，不写“RAG 场景检索”。',
    preferences.separateDevTools && 'Git、GitHub、Gitee归入开发工具组，不能放在AI技能组；AI组仅列模型/检索/工具调用等已有事实。',
    preferences.hideCourseDesignLabel && '投递正文不输出“课程设计”字样；可以省略该标签，但不得因此改成企业任职、商业项目或生产交付。',
    preferences.preferTwoProjectsWithExperience && '已有工作或实习经历时，优先完整保留公司、岗位、日期与本人职责，精选最多2个相关项目，每个最多3条；工作/实习不能塞进项目或简介代替正式经历模块。',
    '个人简介使用2-3个完整短句，突出专业基础、实际工作/项目动作与验证，每句独立换行；不要重复身份。',
    '项目量化优先采用原文已有的功能数量、端数、模型版本数和已记录的测试数量。可对原文逐项列出的功能类别计数，明确这是功能范围；不能推算数据量、性能、用户规模或提升比例。',
  ].filter(Boolean);
  return rules.length ? `\n【本人已保存的简历表达偏好（仅编辑要求，不是经历事实）】\n${rules.join('\n')}` : '';
}
