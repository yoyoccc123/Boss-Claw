import type { TailorResumeDoc } from './jobAssistant';
import type { AppConfig } from './types';
import { cachedCallModel } from './llm';
import { allocateContextBudget, estimateTokens } from './contextBudget';
import { prepareContextText } from './oversizedContext';
import { hasFactQuote, unsupportedClaim } from './resumeFacts';
import { PROJECT_WRITING_RULE, resumePreferenceRule, type ResumeWritingPreferences } from './resumeWriting';

/** A separate factual pass without ATS/skill instructions that encourage inference. */
export async function auditResumeFacts(doc: TailorResumeDoc, facts: string, model: AppConfig['model'], preferences: ResumeWritingPreferences = {}): Promise<TailorResumeDoc> {
  const updated: TailorResumeDoc = JSON.parse(JSON.stringify(doc));
  const items: Array<{ id: string; text: string; source: string }> = [];
  const targets = new Map<string, { text: string; source: string }>();
  const add = (id: string, line: { text: string; source: string }) => {
    if (!line.text) return;
    items.push({ id, ...line }); targets.set(id, line);
  };
  for (const module of ['education', 'internships', 'works', 'projects'] as const) updated[module].forEach((block, i) => block.bullets.forEach((line, j) => add(`${module}.${i}.${j}`, line)));
  updated.skills.forEach((line, i) => add(`skills.${i}`, line));
  add('selfEval', updated.selfEval);
  if (!items.length) return updated;
  const system = `你是简历事实核对员，不负责提高匹配分。逐句检查输入正文，只用本人原始资料；现有source可能错误，不能信任AI草稿自带的source。
${PROJECT_WRITING_RULE}${resumePreferenceRule(preferences)}
必须返回全部原有id，不增删条目。对有依据的句子保留其岗位侧重点；对新增职责、熟练程度、接口实现、算法研发、测试脚本或具体时长，删除无依据部分，改成可由原文证明的实际职责。摘要要有真实贡献与技术链路，不能只摘身份；不能把项目覆盖技术栈当成本人开发模块。资料不足时返回空text，不编占位符。
每条sourceQuotes逐字摘录本人原始资料中支撑text全部声明的片段，可多条；不要引用JD、画像或AI正文。摘要的多项贡献须分别给出对应原文。无需改写则保留text，也须给出真实原文引文。只返回JSON：{"lines":[{"id":"selfEval","text":"核对后的完整句子","sourceQuotes":["逐字原文"]}]}`;
  const payload = JSON.stringify(items);
  const budget = allocateContextBudget(model, { facts: 1 }, { outputTokens: 8192 });
  const material = (await prepareContextText(facts, model, { tokenBudget: Math.max(1000, budget.facts - estimateTokens(system + payload)), cacheScope: 'assistant',
    purpose: '定制简历-独立事实核对', focus: '保留本人项目、职责、能力水平、验证动作、项目性质与原文措辞，不能从相关背景推导能力' })).text;
  const response: any = await cachedCallModel([{ role: 'system', content: system }, { role: 'user', content: `本人原始资料：\n${material}\n待核对的完整条目：${payload}` }], model,
    { maxTokens: 8192, temperature: 0.1 }, { scope: 'assistant', ttlMs: 0 });
  if (!Array.isArray(response?.lines) || response.lines.length !== items.length) throw new Error('AI未完成全部简历事实核对，请重新生成');
  const seen = new Set<string>();
  const needsRepair: typeof items = [];
  for (const item of response.lines) {
    const target = targets.get(item?.id);
    if (!target || seen.has(item.id) || typeof item.text !== 'string' || !Array.isArray(item.sourceQuotes)) throw new Error('AI事实核对条目不完整，请重新生成');
    seen.add(item.id);
    const quotes = item.sourceQuotes.filter((quote: unknown): quote is string => typeof quote === 'string' && !!quote.trim());
    if (item.text.trim() && (!quotes.length || !quotes.every((quote: string) => hasFactQuote(quote, facts)) || unsupportedClaim(item.text, quotes.join('\n')))) {
      needsRepair.push({ id: item.id, text: item.text.trim(), source: target.source });
      target.text = ''; target.source = '';
    } else { target.text = item.text.trim(); target.source = quotes.join('；'); }
  }
  if (needsRepair.length) {
    // Repair only the bad citations once; already verified lines stay intact.
    // Unverifiable replacements are omitted instead of breaking the entire draft.
    try {
      const repair: any = await cachedCallModel([{ role: 'system', content: system + '\n本轮仅修复引文无法定位或引文不能支持职责/能力水平的条目。逐字复制实际存在的原文；不能证明完整text时删去多余声明或返回空text。不要返回其他id。' },
        { role: 'user', content: `本人原始资料：\n${material}\n待核对的完整条目：${JSON.stringify(needsRepair)}` }], model,
      { maxTokens: 4096, temperature: 0.1 }, { scope: 'assistant', ttlMs: 0 });
      const repairIds = new Set(needsRepair.map(item => item.id));
      const repaired = new Set<string>();
      if (Array.isArray(repair?.lines)) for (const line of repair.lines) {
        if (!repairIds.has(line?.id) || repaired.has(line.id) || typeof line.text !== 'string' || !Array.isArray(line.sourceQuotes)) continue;
        repaired.add(line.id);
        const quotes = line.sourceQuotes.filter((quote: unknown): quote is string => typeof quote === 'string' && !!quote.trim());
        if (line.text.trim() && quotes.length && quotes.every((quote: string) => hasFactQuote(quote, facts)) && !unsupportedClaim(line.text, quotes.join('\n'))) {
          const target = targets.get(line.id)!;
          target.text = line.text.trim(); target.source = quotes.join('；');
        }
      }
    } catch { /* Keep the verified lines and omit the unproven ones. */ }
  }
  for (const module of ['education', 'internships', 'works', 'projects'] as const) updated[module].forEach(block => { block.bullets = block.bullets.filter(line => line.text); });
  updated.skills = updated.skills.filter(line => line.text);
  return updated;
}
