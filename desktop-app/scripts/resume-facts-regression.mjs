// Real failure cases: contribution upgrades, borrowed proficiency, false coverage,
// unfinished skills, stored preferences and source references across rehydration.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-resume-facts-'));
const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
try {
  const outfile = join(temporary, 'logic.cjs');
  await build({ stdin: { contents: "export * from './src/lib/bossclaw/jobAssistant'; export * from './src/lib/bossclaw/resumeFacts'; export * from './src/lib/bossclaw/resumeFactAudit'; export * from './src/lib/bossclaw/tailorEvidence'; export * from './src/store/useDataStore';", resolveDir: root, loader: 'ts' },
    tsconfig: join(root, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent',
    plugins: [{ name: 'offline-model', setup(api) { api.onLoad({ filter: /[\\/]llm\.ts$/ }, ({ path }) => ({ contents: readFileSync(path, 'utf8').replace('export async function cachedCallModel(', 'async function originalCachedCallModel(') + '\nexport const cachedCallModel = (...args: any[]) => (globalThis as any).__modelHook(...args);', loader: 'ts' })); } }],
  });
  const { normalizeTailorDoc, enforceResumeFacts, pointProofIsSpecific, unsupportedClaim, tailorForJob, recheckTailorResult, auditResumeFacts, useDataStore,
    directTailorPointProof, retainedPointProof, preserveTailorCoverage, isAdditiveTailorIteration, hasTailorPointCorrection, tailorSupplementFacts } = createRequire(import.meta.url)(outfile);
  const summary = '2027届人工智能本科生，参与课程项目设计与测试。';
  const project = '参与无人台球室原型设计，项目覆盖Flask后端服务；参与订单模块测试和流程验证。';
  const skill = '大模型 API、LangChain、RAG 场景检索、Git、GitHub / Gitee、VS Code、PyCharm、Claude、Codex、Trae 等 AI 编程工具。';
  const facts = `个人简介\n${summary}\n无人台球室\n课程设计\n${project}\n${skill}\n了解数据库表设计\n2026年获省赛三等奖。`;
  const preferences = { omitCourseList: true, omitPatentPreparation: true, conciseRagLabel: true, separateDevTools: true };
  const doc = normalizeTailorDoc({ projects: [{ heading: '无人台球室 | 后端开发', meta: 'Flask', bullets: [{ text: '负责Flask后端开发，实现订单接口。', source: project }] }],
    skills: [{ text: `AI：熟练使用${skill}`, source: skill }],
    selfEval: { text: '用Flask实现订单接口，完成后台模块开发。', source: summary },
    education: [{ heading: '示例学校', bullets: [{ text: '相关课程：计算机视觉、深度学习、计算机网络。', source: '相关课程：计算机视觉、深度学习、计算机网络。' }] }],
  });
  const guarded = enforceResumeFacts(doc, facts, preferences);
  assert.equal(guarded.doc.projects[0].bullets[0].text, project, '参与测试不能变成本人实现后端接口');
  assert.equal(guarded.doc.selfEval.text, summary, '摘要同样受职责守卫约束');
  assert.ok(guarded.doc.projects[0].heading.includes('课程设计'), '项目性质必须保留');
  assert.ok(!guarded.doc.projects[0].heading.includes('后端开发'), '标题也不能把参与测试变成后端开发');
  assert.ok(!guarded.doc.skills.some(line => /熟练/.test(line.text)), '裸技能来源不能增加熟练程度');
  assert.ok(guarded.doc.skills.filter(line => /^AI/.test(line.text)).every(line => !/Git|Gitee/.test(line.text)));
  assert.ok(guarded.doc.skills.some(line => /^开发工具/.test(line.text) && /Git/.test(line.text)));
  assert.ok(!JSON.stringify(guarded.doc.education).includes('相关课程'));
  assert.ok(!guarded.doc.skills.some(line => /RAG 场景检索/.test(line.text)));
  const longSkill = '开发工具：' + '使用 Claude、Codex、Trae 辅助阅读代码、调试和原型迭代；'.repeat(6) + '通过离线案例核对功能。';
  const retained = normalizeTailorDoc({ skills: [{ text: longSkill, source: longSkill }] }).skills[0];
  assert.equal(retained.text, longSkill, '超过120字符的技能不得中途硬截断');
  const inventedSource = enforceResumeFacts(normalizeTailorDoc({ skills: [{ text: '精通Embedding', source: '精通Embedding' }] }), facts);
  assert.equal(inventedSource.doc.skills.length, 0, '来源字段非空不等于原文真的存在');
  assert.equal(pointProofIsSpecific('了解大模型与 Embedding', ['实践RAG和大模型API']), false);
  assert.equal(pointProofIsSpecific('FastAPI/向量库基础', ['实践FastAPI接口']), false, '复合条件中缺少向量库不能算具备');
  assert.equal(pointProofIsSpecific('一年以上深度学习学习研究', ['2026年获省赛三等奖。']), false, '获奖年份不是学习研究时长');
  assert.equal(pointProofIsSpecific('RESTful API设计开发', [project]), false, '项目覆盖后端不是接口设计证明');
  assert.equal(pointProofIsSpecific('了解数据库表设计', ['希望了解数据库表设计']), false);
  assert.equal(pointProofIsSpecific('一年以上深度学习研究', ['每周参加一次深度学习课程']), false);
  assert.equal(pointProofIsSpecific('一年以上深度学习研究', ['进行过两个月深度学习研究']), false);
  assert.equal(pointProofIsSpecific('一年以上深度学习研究', ['进行过一年深度学习研究']), true);
  assert.equal(pointProofIsSpecific('每周5天，实习3个月', ['每周可到岗4天，持续实习6个月']), false);
  assert.equal(pointProofIsSpecific('每周5天，实习3个月', ['每周可到岗5天，持续实习1个月']), false);
  assert.equal(pointProofIsSpecific('每周5天，实习3个月', ['每周5天，可持续实习6个月']), true);
  assert.equal(pointProofIsSpecific('REST API设计', ['参与接口测试，负责项目设计']), false);
  assert.equal(pointProofIsSpecific('REST API设计', ['未负责 API 设计，参与测试']), false);
  assert.equal(pointProofIsSpecific('REST API设计', ['参与 REST API 设计与实现']), true);
  assert.equal(pointProofIsSpecific('熟练使用 Python', ['编程：Python、面向对象、自动化脚本']), false);
  assert.equal(pointProofIsSpecific('看懂基础 SQL', ['使用 MySQL 存储媒体信息并支持基础查询']), false);
  assert.equal(pointProofIsSpecific('问题分析与解决', ['参与订单模块的测试，核对业务流程']), false);
  assert.equal(pointProofIsSpecific('模型 API 对接测试', ['参与词典 API、大模型 API 的集成', '使用离线页面案例验证发送判定']), false, '不同项目的API集成与页面验证不可拼成模型API测试');
  assert.equal(pointProofIsSpecific('模型 API 对接测试', ['参与大模型 API 集成与测试']), true);
  assert.equal(pointProofIsSpecific('模型测试与误报漏报记录', ['完成YOLO模型训练与检测效果验证']), false);
  assert.equal(pointProofIsSpecific('模型测试与误报漏报记录', ['测试YOLO模型，记录误报与漏报样本']), true);
  assert.equal(pointProofIsSpecific('图片数据整理清洗标注', ['完成自定义数据标注']), false);
  assert.equal(pointProofIsSpecific('机器学习与数据挖掘', ['完成MNIST模型训练实验']), false);
  assert.equal(unsupportedClaim('熟练 Python 和 SQL', '熟练 Python；了解 SQL'), true);
  assert.equal(unsupportedClaim('熟练 Python；了解 SQL', '熟练 Python；了解 SQL'), false);
  const missingTitles = enforceResumeFacts(normalizeTailorDoc({ projects: [{ heading: '', bullets: [{ text: project, source: project }] }] }), facts).doc;
  assert.equal(missingTitles.projects[0].heading, '无人台球室 | 课程设计', '空标题应从对应项目恢复，不能匹配全篇第一个标签');
  assert.equal(normalizeTailorDoc({ projects: [{ title: '智能相册', bullets: [project] }] }).projects[0].heading, '智能相册');
  const local = await tailorForJob({ title: '本地测试岗位', description: 'Python' }, facts, { summary, facts: { skills: [skill], projects: [`无人台球室\n课程设计\n${project}`] } }, {}, undefined, undefined, { writingPreferences: preferences });
  assert.equal(local.method, 'local');
  assert.equal(local.doc.projects[0].bullets[0].text, project, '本地兜底也须保留完整项目要点，不能硬截为标题');
  assert.ok(!JSON.stringify(local.highlightedSkills).includes('RAG 场景检索'), 'AI失败时仍执行已保存偏好');
  assert.equal(local.doc.selfEval.text, summary);
  const withInternship = enforceResumeFacts(normalizeTailorDoc({ internships: [{ heading: '示例公司', meta: 'Python实习生', bullets: [{ text: project, source: project }] }], projects: Array.from({ length: 3 }, () => ({ heading: '无人台球室 | 课程设计', meta: '课程设计', bullets: [{ text: project, source: project }] })), selfEval: { text: summary, source: summary } }), facts, { hideCourseDesignLabel: true, preferTwoProjectsWithExperience: true });
  assert.equal(withInternship.doc.projects.length, 2);
  assert.ok(!withInternship.doc.projects[0].heading.includes('课程设计'));
  assert.equal(withInternship.doc.internships[0].bullets[0].text, project, '精简项目不能删掉公司经历');
  const originalProjects = Array.from({ length: 4 }, (_, i) => ({ heading: `原项目${i + 1}`, meta: '2026.05｜课程设计｜Python', bullets: Array.from({ length: 4 }, (_, j) => ({ text: `原项目${i + 1}的原始描述${j + 1}。`, source: `原项目${i + 1}的原始描述${j + 1}。` })) }));
  const preservedFacts = `个人简介\n${summary}\n项目经历\n${originalProjects.flatMap(p => [p.heading, p.meta, ...p.bullets.map(b => b.text)]).join('\n')}\n其他技术实践\n这条不属于最后一个项目。`;
  const protectedPreferences = { preserveProjectText: true, preferTwoProjectsWithExperience: true, hideCourseDesignLabel: true };
  const preserved = enforceResumeFacts(withInternship.doc, preservedFacts, protectedPreferences).doc.projects;
  assert.deepEqual(preserved, originalProjects.map(p => ({ ...p, meta: '2026.05｜Python' })), '保留原文优先于AI改写、项目上限和要点上限，且不串入下个模块');
  const preservedLocal = await tailorForJob({ title: 'Python实习', description: 'Python' }, preservedFacts, { summary, facts: { projects: [] } }, {}, undefined, undefined, { writingPreferences: protectedPreferences });
  assert.deepEqual(preservedLocal.doc.projects, preserved, '画像缺少项目时本地兜底也须从原文恢复全部项目');
  const brief = '其他项目实践：3D 装修交互原型（Three.js / 大模型 API / ASR）。';
  const briefFacts = preservedFacts.replace('其他技术实践\n', brief + '\n其他技术实践\n');
  const withBrief = enforceResumeFacts(withInternship.doc, briefFacts, protectedPreferences).doc.projects;
  assert.deepEqual(withBrief.slice(0, 4), preserved, '单行项目不能混入前一个项目的要点');
  assert.deepEqual(withBrief[4], { heading: brief, meta: '', bullets: [] }, '其他项目实践作为一行独立保存，原文保护不丢失');
  const middleBriefFacts = preservedFacts.replace('原项目2\n', brief + '\n原项目2\n');
  assert.deepEqual(enforceResumeFacts(withInternship.doc, middleBriefFacts, protectedPreferences).doc.projects.map(p => p.heading), ['原项目1', brief, '原项目2', '原项目3', '原项目4'], '相同技术栈的项目也必须尊重单行项目所在位置');
  const finalDoc = normalizeTailorDoc({ skills: [{ text: '了解数据库表设计', source: '了解数据库表设计' }, { text: '实践RAG和大模型API', source: skill }], selfEval: { text: summary, source: summary } });
  const points = ['了解数据库表设计', '了解大模型与 Embedding', '一年以上深度学习学习研究'].map(point => ({ point, layer: 'must', verdict: 'covered', evidence: '旧判定' }));
  const result = { doc: finalDoc, jdPoints: points, supplements: [], aiMatch: null };
  let calls = 0;
  globalThis.__modelHook = async messages => {
    calls++;
    assert.ok(messages[0].content.includes('factQuotes'));
    return { jdPoints: [
      { id: 'p1', verdict: 'covered', evidence: '正文与原始材料都明确了解表设计', factQuotes: ['了解数据库表设计'], bodyQuotes: ['了解数据库表设计'] },
      { id: 'p2', verdict: 'covered', evidence: '有RAG所以会Embedding', factQuotes: [skill], bodyQuotes: ['实践RAG和大模型API'] },
      { id: 'p3', verdict: 'covered', evidence: '2026年已经获奖', factQuotes: ['2026年获省赛三等奖。'], bodyQuotes: [summary] },
    ], matchScore: { before: 50, after: 70 }, resume: { selfEval: { text: '不应覆盖正文' } } };
  };
  const checked = await recheckTailorResult({ result, job: { title: '测试岗位' }, resumeText: facts, profile: null, model: { apiKey: 'offline', model: 'offline', provider: 'custom', contextWindow: 128000 } });
  assert.deepEqual(checked.jdPoints.map(point => point.verdict), ['covered', 'missing', 'missing']);
  assert.equal(checked.aiMatch, null, '要点判定纠正后不展示基于错误判定的分数');
  assert.equal(checked.doc, result.doc, '复核只能改判定，不允许模型修改正文');
  assert.equal(calls, 1);
  globalThis.__modelHook = async () => ({ jdPoints: points.map((_, i) => ({ id: `p${i + 1}`, verdict: i===0?'covered':'missing', evidence: i===0?'了解表设计已体现':'本人资料不足', factQuotes: i===0?['了解数据库表设计']:[], bodyQuotes: i===0?['了解数据库表设计']:[] })), matchScore: { before: 40, after: 42 } });
  const retried = await recheckTailorResult({ result: { ...checked, warning: '已按原始证据纠正部分要点，未采纳基于原判定的 AI 匹配分。' }, job: { title: '测试岗位' }, resumeText: facts, profile: null, model: { apiKey: 'offline', model: 'offline', provider: 'custom', contextWindow: 128000 } });
  assert.equal(retried.warning, undefined, '重新复核成功后应清理上一轮未采纳评分的提示');
  assert.equal(retried.aiMatch.after, 42);
  const auditDoc = normalizeTailorDoc({ selfEval: { text: '熟练开发后端接口。', source: summary } });
  const auditModel = { apiKey: 'offline', model: 'offline', provider: 'custom', contextWindow: 128000 };
  globalThis.__modelHook = async messages => {
    assert.ok(messages[0].content.startsWith('你是简历事实核对员'));
    assert.ok(!messages[0].content.includes('泛化能力'));
    return { lines: [{ id: 'selfEval', text: summary, sourceQuotes: [summary] }] };
  };
  const factual = await auditResumeFacts(auditDoc, facts, auditModel, preferences);
  assert.equal(factual.selfEval.text, summary, '独立核对修正摘要，不能信任AI自带source');
  assert.equal(auditDoc.selfEval.text, '熟练开发后端接口。', '不修改已有文档对象');
  globalThis.__modelHook = async () => ({ lines: [{ id: 'selfEval', text: '熟练开发后端接口。', sourceQuotes: [summary] }] });
  assert.equal((await auditResumeFacts(auditDoc, facts, auditModel)).selfEval.text, '', '引用真实原文却不能证明技术职责仍须拒绝');
  let repairCalls = 0;
  globalThis.__modelHook = async () => (++repairCalls === 1
    ? { lines: [{ id: 'selfEval', text: summary, sourceQuotes: ['改写后的伪引文'] }] }
    : { lines: [{ id: 'selfEval', text: summary, sourceQuotes: [summary] }] });
  assert.equal((await auditResumeFacts(auditDoc, facts, auditModel)).selfEval.text, summary);
  assert.equal(repairCalls, 2, '只修复无效引文一次');
  globalThis.__modelHook = async () => ({ lines: [{ id: 'selfEval', text: '编造的接口实现', sourceQuotes: ['编造的证据'] }] });
  assert.equal((await auditResumeFacts(auditDoc, facts, auditModel)).selfEval.text, '', '修复后仍无依据的条目必须移除');
  for (const invalid of [{ lines: [] }, { lines: [{ id: 'other', text: summary, sourceQuotes: [summary] }] }]) {
    globalThis.__modelHook = async () => invalid;
    await assert.rejects(() => auditResumeFacts(auditDoc, facts, auditModel), /事实核对/);
  }
  // Reproduce additive rounds dropping earlier skills, and a reviewer overlooking unchanged evidence.
  const gitQuote = '使用 Git 管理代码修改，参与功能测试和问题修复。';
  const toolQuote = 'AI Coding：熟练使用 Claude、Codex、Trae 等 AI 编程工具，阅读、验证和迭代生成结果。';
  const familiarTools = '熟悉 Claude、Codex、Trae 等 AI 编程工具，能够阅读生成结果。';
  const sqlQuote = '了解 SQL 语法。', dockerQuote = '了解 Docker 容器基础。';
  const educationFacts = '教育背景\n示例大学｜人工智能｜本科\n2023.09–2027.06\n个人简介\n2027届人工智能专业本科生。\n个人荣誉\n2026年获得竞赛奖项。';
  const educationDoc = normalizeTailorDoc({ education: [{ heading: '示例大学｜人工智能｜本科', meta: '2023.09–2027.06' }] });
  assert.ok(directTailorPointProof('2026/2027届本科', educationDoc, educationFacts), '届别备选年份满足其中一个即可，不能要求同时毕业两次');
  assert.ok(directTailorPointProof('本科及以上在读', educationDoc, educationFacts), '正文已有本科学历和在读日期不能判为只在原文里具备');
  assert.equal(directTailorPointProof('2026/2027届本科', normalizeTailorDoc({ education: [{ heading: '示例大学｜人工智能｜本科', meta: '2019.09–2023.06' }] }), educationFacts.replace('2023.09–2027.06', '2019.09–2023.06').replace('2027届', '2023届')), null, '获奖年份不能充当毕业年份');
  assert.equal(directTailorPointProof('硕士及以上', educationDoc, educationFacts), null);
  assert.equal(directTailorPointProof('本科及以上在读', normalizeTailorDoc({ selfEval: { text: '2023届人工智能本科生。', source: '2023届人工智能本科生。' } }), '2023届人工智能本科生。'), null, '过去届别的本科生身份不证明现在在读');
  assert.equal(directTailorPointProof('计算机专业本科', educationDoc, educationFacts), null, '学历证据不替代专业等复合条件核对');
  assert.equal(directTailorPointProof('全日制本科', educationDoc, educationFacts), null, '本科不能自动推出全日制');
  assert.equal(directTailorPointProof('熟练使用AI编程工具', normalizeTailorDoc({ skills: [{ text: familiarTools, source: familiarTools }] }), familiarTools), null, '熟悉不能被保留机制升级成熟练');
  assert.equal(pointProofIsSpecific('熟练使用AI编程工具', ['熟练使用 Git；熟悉 Claude、Codex、Trae 等 AI 编程工具。']), false, '其他技能的熟练程度不能借给AI编程工具');
  assert.equal(pointProofIsSpecific('熟练使用AI编程工具', [toolQuote]), true);
  const cleaned = tailorSupplementFacts(`【岗位要点：熟练使用AI编程工具】\n${familiarTools}`);
  assert.equal(cleaned, familiarTools, '要点定位标签从事实证据中移除，确认的用户文字仍保留');
  const previousDoc = normalizeTailorDoc({ skills: [{ text: gitQuote, source: gitQuote }, { text: toolQuote, source: toolQuote }], selfEval: { text: summary, source: summary } });
  const oldSupplements = [{ text: `【岗位要点：熟练使用AI编程工具】\n${toolQuote}`, createdAt: 1 }];
  const makePoint = (point, verdict, quote) => ({ point, layer: 'must', verdict, statusVerified: true, evidence: '已核对原文和正文', factQuotes: quote ? [quote] : [], bodyQuotes: quote ? [quote] : [] });
  const previousResult = { ...local, doc: previousDoc, supplements: oldSupplements, aiMatch: { before: 50, after: 68 },
    jdPoints: [makePoint('Git工程实践', 'covered', gitQuote), makePoint('熟练使用AI编程工具', 'covered', toolQuote), makePoint('了解SQL语法', 'missing'), makePoint('了解Docker容器基础', 'missing')] };
  const baseFacts = `个人简介\n${summary}\n专业技能\n${gitQuote}`;
  const allFacts = `${baseFacts}\n${toolQuote}\n${sqlQuote}`;
  assert.ok(retainedPointProof(previousResult.jdPoints[0], previousResult, allFacts, previousDoc));
  assert.equal(retainedPointProof(previousResult.jdPoints[0], previousResult, allFacts, normalizeTailorDoc({ skills: [] })), null, '旧绿色不能代替最终正文中的实际证据');
  assert.equal(retainedPointProof(previousResult.jdPoints[0], previousResult, toolQuote, previousDoc), null, '来源被移除后不能沿用旧状态');
  assert.equal(hasTailorPointCorrection('Git工程实践', [{ text: '删除 Git 技能', createdAt: 2 }]), true);
  assert.equal(hasTailorPointCorrection('熟练使用AI编程工具', [{ text: '删除 Git 技能', createdAt: 2 }]), false, '未标注的单项删除不影响无关要点');
  assert.equal(isAdditiveTailorIteration(previousResult, [...oldSupplements, { text: '删除全部内容', createdAt: 2 }]), false, '明确整体重写不回填旧内容');
  assert.equal(hasTailorPointCorrection('了解Docker容器基础', [{ text: '【岗位要点：了解Docker容器基础】\n没有做过企业生产部署。', createdAt: 2 }]), false, '否定企业生产部署不否定个人容器基础');
  assert.equal(hasTailorPointCorrection('线上部署经验', [{ text: '更正：没有参与企业部署。', createdAt: 2 }]), true);
  assert.equal(hasTailorPointCorrection('Git工程实践', [{ text: '更正：没有参与企业部署。', createdAt: 2 }]), false, '未标注的部署纠错不抹掉Git证据');
  const supplements = [...oldSupplements, { text: `【岗位要点：了解SQL语法】\n${sqlQuote}`, createdAt: 2 }];
  assert.equal(isAdditiveTailorIteration(previousResult, supplements), true);
  assert.equal(isAdditiveTailorIteration(previousResult, [...oldSupplements, { text: '【岗位要点：了解Docker容器基础】\n没有做过企业生产部署。', createdAt: 2 }]), true, '目标要点的否定不能让其他已确认要点失去保护');
  const omitted = { ...previousResult, supplements, doc: normalizeTailorDoc({ skills: [{ text: sqlQuote, source: sqlQuote }], selfEval: { text: summary, source: summary } }),
    jdPoints: previousResult.jdPoints.map(p => ({ ...p, verdict: 'missing', factQuotes: [], bodyQuotes: [] })) };
  const restored = preserveTailorCoverage(previousResult, omitted, allFacts);
  assert.deepEqual(restored.restored, ['Git工程实践', '熟练使用AI编程工具']);
  assert.ok(restored.doc.skills.some(line => line.text === sqlQuote) && restored.doc.skills.some(line => line.text === gitQuote) && restored.doc.skills.some(line => line.text === toolQuote));
  assert.equal(previousResult.doc.skills.length, 2, '不修改已保存的上一版或历史导出快照');
  const deletion = preserveTailorCoverage(previousResult, { ...omitted, supplements: [...oldSupplements, { text: '【岗位要点：Git工程实践】\n删除 Git 技能', createdAt: 2 }] }, allFacts);
  assert.ok(!deletion.doc.skills.some(line => line.text === gitQuote), '明确删除的目标内容不被自动补回');
  const labelOnly = { ...previousResult, jdPoints: [makePoint('熟练使用AI编程工具', 'missing')], doc: normalizeTailorDoc({ skills: [{ text: '熟练使用AI编程工具', source: '【岗位要点：熟练使用AI编程工具】' }] }),
    supplements: [{ text: `【岗位要点：熟练使用AI编程工具】\n${familiarTools}`, createdAt: 1 }] };
  globalThis.__modelHook = async () => ({ jdPoints: [{ id: 'p1', verdict: 'covered', evidence: '误把定位标签当经历', factQuotes: ['【岗位要点：熟练使用AI编程工具】'], bodyQuotes: ['熟练使用AI编程工具'] }], matchScore: { before: 40, after: 70 } });
  const labelChecked = await recheckTailorResult({ result: labelOnly, job: { title: '测试岗位' }, resumeText: familiarTools, profile: null, model: auditModel });
  assert.equal(labelChecked.jdPoints[0].verdict, 'missing', 'JD标签不作为技能事实，不把熟悉升级成熟练');

  let targetLine = sqlQuote, rechecks = 0, failSecond = false, failFirst = false;
  const cover = '您好，我想应聘贵公司的Python实习岗位。' + '我希望结合自己的真实项目与实际操作，进一步了解岗位的工作内容、团队协作方式和具体要求；愿意在沟通中介绍已经完成的实践，并明确自己接触过的内容和需要继续学习的部分。'.repeat(2) + '感谢您阅读，期待有机会进一步交流。';
  globalThis.__modelHook = async messages => {
    const system = messages[0].content;
    if (system.startsWith('你是求职者的求职助手')) return { tailoredSummary: summary, coverLetter: cover, resume: { skills: [{ text: targetLine, source: targetLine }], selfEval: { text: summary, source: summary } },
      jdPoints: [{ point: targetLine.replace(/\s|。/g, ''), layer: 'must', verdict: 'covered', evidence: '本轮新增' }], matchScore: { before: 50, after: 70 } };
    if (system.startsWith('你是资深招聘方')) return {};
    if (system.startsWith('你是简历事实核对员')) {
      const items = JSON.parse(messages[1].content.split('待核对的完整条目：')[1]);
      return { lines: items.map(item => ({ id: item.id, text: item.text, sourceQuotes: [item.source] })) };
    }
    if (system.startsWith('你是简历最终正文复核员')) {
      rechecks++;
      if ((failFirst && rechecks === 1) || (failSecond && rechecks === 2)) throw Error('offline review unavailable');
      return { jdPoints: previousResult.jdPoints.map((_, i) => ({ id: `p${i + 1}`, verdict: 'missing', evidence: '本轮模型漏看既有证据', factQuotes: [], bodyQuotes: [] })), matchScore: { before: 50, after: 55 } };
    }
    return { greeting: cover, coverLetter: cover };
  };
  const iterationProfile = { summary, facts: { skills: [gitQuote], projects: [], education: [] } };
  const iterated = await tailorForJob({ title: 'Python实习', description: 'Git工程实践；熟练使用AI编程工具；了解SQL语法；了解Docker容器基础' }, baseFacts, iterationProfile, auditModel, undefined, undefined, { supplements, previousResult });
  assert.equal(iterated.method, 'ai');
  assert.deepEqual(iterated.jdPoints.map(p => p.point), previousResult.jdPoints.map(p => p.point), '补充期间要点名称、顺序、层级不随模型输出漂移');
  assert.deepEqual(iterated.jdPoints.map(p => p.verdict), ['covered', 'covered', 'covered', 'missing'], '恢复有来源的旧内容后，新要点与旧要点同时保留');
  assert.ok(iterated.jdPoints.every(p => p.statusVerified));
  assert.equal(iterated.previousScore, 68);
  assert.equal(iterated.aiMatch, null, '修正模型漏判后不沿用与最终要点不一致的分数');
  assert.equal(rechecks, 2, '发生实际内容丢失时最多恢复并复核一次');
  assert.ok(iterated.highlightedSkills.includes(gitQuote) && iterated.highlightedSkills.includes(sqlQuote), '面板技能与恢复后的正文同步');
  targetLine = dockerQuote; rechecks = 0;
  const nextSupplements = [...supplements, { text: `【岗位要点：了解Docker容器基础】\n${dockerQuote}`, createdAt: 3 }];
  const next = await tailorForJob({ title: 'Python实习', description: 'Git工程实践；熟练使用AI编程工具；了解SQL语法；了解Docker容器基础' }, baseFacts, iterationProfile, auditModel, undefined, undefined, { supplements: nextSupplements, previousResult: iterated });
  assert.deepEqual(next.jdPoints.map(p => p.verdict), ['covered', 'covered', 'covered', 'covered'], '多轮补充保留前几轮的真实技能与引文');
  assert.equal(next.supplements.length, 3);
  targetLine = sqlQuote; rechecks = 0; failSecond = true;
  const interrupted = await tailorForJob({ title: 'Python实习', description: '同一岗位要求' }, baseFacts, iterationProfile, auditModel, undefined, undefined, { supplements, previousResult });
  assert.equal(interrupted.method, 'ai');
  assert.ok(interrupted.jdPoints[0].statusVerified && interrupted.jdPoints[1].statusVerified, '复核失败时仍有效的既有引文不全部变成待复核');
  assert.equal(interrupted.jdPoints[2].statusVerified, false, '本轮新判定失败时保留待复核，不能把所有要点硬改成绿色');
  assert.ok(interrupted.doc.skills.some(line => line.text === sqlQuote));
  assert.equal(previousResult.doc.skills.length, 2);
  rechecks = 0; failSecond = false; failFirst = true;
  const firstInterrupted = await tailorForJob({ title: 'Python实习', description: '同一岗位要求' }, baseFacts, iterationProfile, auditModel, undefined, undefined, { supplements, previousResult });
  assert.ok(firstInterrupted.jdPoints[0].statusVerified && firstInterrupted.jdPoints[1].statusVerified, '初次复核失败同样保留有原文依据的旧要点');
  assert.ok([gitQuote, toolQuote, sqlQuote].every(q => firstInterrupted.doc.skills.some(l => l.text === q)), '复核不可用时仍恢复被改写遗漏的正文，保留本轮新增内容');
  assert.equal(firstInterrupted.jdPoints[2].statusVerified, false);
  assert.equal(rechecks, 1, '服务不可用时不循环请求');

  const store = useDataStore.getState();
  store.setResumeText(facts, '本人素材.txt');
  store.setResumeWritingPreferences(preferences);
  store.addExperienceMaterial({ name: '工程素材.txt', path: 'E:\\fixtures\\工程素材.txt' });
  await new Promise(resolve => setTimeout(resolve, 400));
  const stored = JSON.parse(saved.get('bossclaw-data')).state;
  assert.deepEqual(stored.resumeWritingPreferences, preferences);
  assert.equal(stored.experienceMaterials[0].path, 'E:\\fixtures\\工程素材.txt');
  useDataStore.setState({ experienceMaterials: [], resumeWritingPreferences: {} });
  await useDataStore.persist.rehydrate();
  assert.deepEqual(useDataStore.getState().resumeWritingPreferences, preferences, '重启读取仍保留偏好');
  assert.equal(useDataStore.getState().experienceMaterials.length, 1, '补充文件引用重启后仍可用');
  console.log('PASS resume facts: 原文定位、摘要/职责/水平保真、项目性质、表达偏好、双重引文、学历与AI工具要求、多轮补充保留、纠错优先、复核中断恢复、复核只读及重启留存。');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
