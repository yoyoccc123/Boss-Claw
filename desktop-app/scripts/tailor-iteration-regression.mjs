// 多轮补充回归：真实生成流程（仅替换模型调用）+ Electron 中实际 React 页面交互。
// 使用隔离临时目录和离线模型，不读取用户资料、不联网、不投递。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-tailor-iteration-'));
const modelMock = { name: 'offline-model', setup(api) {
  api.onLoad({ filter: /[\\/]llm\.ts$/ }, ({ path }) => ({
    contents: readFileSync(path, 'utf8').replace('export async function cachedCallModel(', 'async function originalCachedCallModel(')
      + '\nexport const cachedCallModel = (...args: any[]) => (globalThis as any).__modelHook(...args);', loader: 'ts',
  }));
} };
const bundle = async (contents, outfile, platform) => build({
  stdin: { contents, loader: 'tsx', resolveDir: root }, tsconfig: join(root, 'tsconfig.json'),
  bundle: true, format: platform === 'node' ? 'cjs' : 'iife', platform, outfile, logLevel: 'silent', plugins: [modelMock],
});
const profile = {
  summary: '本科在读，参与知识库项目。',
  facts: { education: ['本科在读'], projects: ['知识库项目'], experiences: [], skills: ['熟悉 Python'], certificates: [], capabilities: [] },
  primaryDirections: [], secondaryDirections: [], searchKeywords: [], excludeDirections: [],
  hardConstraints: { locations: [], employmentTypes: [], salary: '', experience: '', degree: '本科' },
};
const resume = '示例候选人，本科在读，熟悉 Python，参与知识库项目。';
const job = { title: 'AI 应用实习生', company: '示例甲公司', description: '开发 Python 知识库，负责文档切分、RAG 检索与测试。', salary: '150元/天', location: '广州', platform: 'boss' };
const coverLetter = '您好，我想应聘贵公司的AI应用实习生岗位。我是本科在读学生，参与过知识库项目，熟悉Python，负责相关功能开发和验证。希望结合已有项目经验，参与贵公司的知识库应用开发，在实际任务中进一步完善检索、测试和接口联调流程。我对岗位所涉及的应用开发与问题排查工作很感兴趣，希望有机会详细交流我的项目职责和实践过程，谢谢。';
const draft = (text = '参与知识库项目。', after = 72) => ({
  highlightedSkills: ['Python'], tailoredSummary: profile.summary, tailoredExperiences: [text], coverLetter,
  skillGaps: ['需要补充检索测试细节'], suggestions: ['补充项目职责'],
  resume: { projects: [{ heading: '知识库项目', meta: 'Python', bullets: [{ text, source: text }] }], skills: [{ text: '熟悉 Python', source: '熟悉 Python' }] },
  jdPoints: [{ point: '检索测试', layer: 'duty', verdict: 'addable', evidence: '待补充具体职责' }], matchScore: { before: 60, after },
});
const nodeBundle = join(temporary, 'logic.cjs');
await bundle("export * from './src/lib/bossclaw/jobAssistant'; export * from './src/lib/bossclaw/tailorBatch';", nodeBundle, 'node');
const { tailorForJob, appendTailorSupplement, normalizeAiMatch, upsertTailorHistory } = require(nodeBundle);
const calls = [];
let replies = [];
globalThis.__modelHook = async (messages) => {
  calls.push(messages);
  const next = replies.shift();
  if (next instanceof Error) throw next;
  assert.ok(next, '模型调用数量超出预期');
  return next;
};
const model = { apiKey: 'offline-fixture-key', model: 'offline', provider: 'custom', baseUrl: 'https://offline.invalid', contextWindow: 128000 };
replies = [draft(), { matchScore: { before: 60, after: 72 } }];
const first = await tailorForJob(job, resume, profile, model);
assert.equal(first.method, 'ai');
const one = appendTailorSupplement(undefined, '  负责文档切分，测试30条问题。  ', 1);
assert.equal(one[0].text, '负责文档切分，测试30条问题。');
const reviewedDoc = draft('负责文档切分并测试30条问题。').resume;
reviewedDoc.projects[0].bullets[0].source = one[0].text;
replies = [draft(one[0].text, 80), { resume: reviewedDoc, matchScore: { before: 67, after: 84 } }];
const second = await tailorForJob(job, resume, profile, model, undefined, '导入的文件经历', { supplements: one, previousResult: first });
assert.equal(second.aiMatch.after, 84, '评分必须对应回审后的文档');
assert.equal(second.previousScore, 72);
assert.equal(second.supplements.length, 1);
assert.ok(second.rewrites.some((r) => r.from === 'extra'), '文本补充可溯源');
const two = appendTailorSupplement(one, '负责检索评估；请保留测试细节，目标100分。', 2);
replies = [draft(two[1].text, 89), { matchScore: { before: 74, after: 91 } }];
const third = await tailorForJob(job, resume, profile, model, undefined, undefined, { supplements: two, previousResult: second });
assert.equal(third.aiMatch.after, 91, '目标100分不得覆盖模型实际评分');
assert.equal(third.previousScore, 84);
assert.deepEqual(third.supplements, two);
for (const request of calls.slice(-2)) {
  const prompt = request.map((m) => m.content).join('\n');
  assert.ok(prompt.includes(one[0].text) && prompt.includes(two[1].text), '草稿与回审都要收到全部轮次');
  assert.ok(prompt.includes('上一版（仅编辑参考，不是事实来源）'));
  assert.ok(prompt.includes('不得转换成已具备的事实'));
}
assert.deepEqual(one, [{ text: '负责文档切分，测试30条问题。', createdAt: 1 }], '不能修改上一版补充');
assert.deepEqual(appendTailorSupplement(two, '  '), two);
assert.equal(normalizeAiMatch({ before: 'bad', after: 80 }), null);
replies = [draft(), { resume: draft('不同的最终正文').resume }];
assert.equal((await tailorForJob(job, resume, profile, model)).aiMatch, null, '正文已修订但无评分时不能展示旧稿分数');
const historyItem = (id, company, result) => ({ id, jobId: id, company, job, jobTitle: job.title, jobDesc: job.description, createdAt: 1, result });
const saved = upsertTailorHistory([historyItem('a', '示例甲公司', first), historyItem('b', '示例乙公司', first)], historyItem('a', '示例甲公司', third));
assert.equal(saved.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(saved))[0].result.supplements, two);
assert.equal(upsertTailorHistory(saved, { ...historyItem('old', '示例甲公司', third), jobId: undefined }).length, 2, '旧记录也按公司区分');
console.log('PASS: 多轮上下文、事实/指令区分、最终稿评分、来源、历史持久化与兼容。');

// 以下使用实际页面与实际生成函数，仅把模型网络边界替换为确定性回复。
const browserBundle = join(temporary, 'ui.js');
await bundle(`
import React from 'react'; import { createRoot } from 'react-dom/client';
import JobAssistant from './src/pages/JobAssistant';
import { useDataStore } from './src/store/useDataStore'; import { useSettingsStore } from './src/store/useSettingsStore'; import { useAppStore } from './src/store/useAppStore';
import './src/index.css';
const profile=${JSON.stringify(profile)}, job=${JSON.stringify(job)}, coverLetter=${JSON.stringify(coverLetter)};
const base=${JSON.stringify(draft())};
const test:any=window; test.modelCalls=[]; test.failModel=false; test.pdfFiles=[];
test.__modelHook=async(messages:any[])=>{
 test.modelCalls.push(messages); await new Promise(r=>setTimeout(r,80)); if(test.failModel) throw new Error('离线模拟服务失败');
 const rounds=[...messages[1].content.matchAll(/【第(\\d+)轮用户补充】/g)].map((m:any)=>Number(m[1]));
 const round=Math.max(0,...rounds); const score=72+round*8;
 if(messages[0].content.startsWith('你是资深招聘方')) return {matchScore:{before:60,after:score}};
 const output=JSON.parse(JSON.stringify(base)); output.matchScore.after=score;
 if(round) output.resume.projects[0].bullets[0]={text:'第'+round+'轮补充已纳入知识库项目',source:round===1?'补充甲：文档切分与30条测试问题。':'补充乙：负责检索效果评估。'};
 return output;
};
test.electron={savePdfBatch:async(files:any[])=>{test.pdfFiles=files;return {ok:true,directory:'离线测试',results:files.map(f=>({...f,ok:true,filePath:f.fileName}))}}};
useDataStore.setState({resumeText:${JSON.stringify(resume)},profile,pending:['a','b'].map((id,i)=>({id,status:'pending',createdAt:1,deliveryGreeting:'',job:{...job,company:i?'示例乙公司':'示例甲公司'}}))});
useSettingsStore.getState().setModel(${JSON.stringify(model)}); useAppStore.getState().openJobAssistantBatch(['a','b']);
createRoot(document.getElementById('root')!).render(<JobAssistant/>);
`, browserBundle, 'browser');
const htmlPath = join(temporary, 'ui.html');
writeFileSync(htmlPath, '<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
const reportPath = join(temporary, 'report.json');
const screenshotPath = join(temporary, '多轮补充.png');
const entry = join(temporary, 'main.cjs');
mkdirSync(join(temporary, 'profile'));
const runUi = async function () {
  const checks = [];
  const wait = async (predicate, name) => {
    const end = Date.now() + 8000;
    while (!predicate()) { if (Date.now() > end) throw new Error('等待超时：' + name); await new Promise(r => setTimeout(r, 30)); }
  };
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const button = (label, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent.replace(/\s/g, '') === label.replace(/\s/g, ''));
  const history = () => JSON.parse(localStorage.getItem('bossclaw-tailor-history-v1') || '[]');
  const fill = (element, value) => {
    Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await wait(() => button('开始批量生成'), '批量入口'); button('开始批量生成').click();
  await wait(() => history().length === 2, '生成两个岗位');
  check(history().every(h => h.result.aiMatch.after === 72), '初始评分');
  button('查看结果', document.querySelector('.tailor-batch-card')).click();
  await wait(() => document.querySelector('#tailor-supplement-text'), '补充文本框');
  check(button('补充并重新生成').disabled, '空输入不可提交');
  fill(document.querySelector('#tailor-supplement-text'), '补充甲：文档切分与30条测试问题。');
  await wait(() => !button('补充并重新生成').disabled, '文字输入生效');
  const count = window.modelCalls.length; button('补充并重新生成').click(); button('补充并重新生成').click();
  await wait(() => document.querySelector('#tailor-supplement-text').disabled, '生成锁');
  check(document.querySelector('#tailor-supplement-text').disabled, '生成时禁用输入');
  await wait(() => history().find(h => h.jobId === 'a')?.result.supplements?.length === 1, '第一轮保存');
  await wait(() => !document.querySelector('#tailor-supplement-text').disabled, '第一轮结束');
  check(window.modelCalls.length - count === 2, '重复点击只生成一次');
  check(document.querySelector('#tailor-supplement-text').value === '', '成功后清空当前输入');
  check(document.querySelector('[data-testid="tailor-iteration-score"]').textContent.includes('72 分 → 本轮 80 分'), '上一版与本轮评分');
  fill(document.querySelector('#tailor-supplement-text'), '补充乙：负责检索效果评估。');
  await wait(() => !button('补充并重新生成').disabled, '第二轮输入'); button('补充并重新生成').click();
  await wait(() => history().find(h => h.jobId === 'a')?.result.supplements?.length === 2, '第二轮保存');
  await wait(() => !document.querySelector('#tailor-supplement-text').disabled, '第二轮结束');
  check(history().find(h => h.jobId === 'a').result.aiMatch.after === 88, '多轮后重新评分');
  check(history().find(h => h.jobId === 'b').result.supplements.length === 0, '补充不串到另一岗位');
  window.failModel = true; fill(document.querySelector('#tailor-supplement-text'), '失败时保留输入');
  await wait(() => !button('补充并重新生成').disabled, '失败测试输入'); button('补充并重新生成').click();
  await wait(() => document.querySelector('#tailor-supplement-text').disabled, '失败测试开始');
  await wait(() => !document.querySelector('#tailor-supplement-text').disabled, '失败测试结束');
  check(document.querySelector('#tailor-supplement-text').value === '失败时保留输入', 'AI失败保留输入');
  check(history().find(h => h.jobId === 'a').result.aiMatch.after === 88, 'AI失败保留上一版');
  window.failModel = false;
  // 从历史恢复后继续补充，必须保持原 jobId 和另一家公司记录。
  button('查看').click();
  await wait(() => document.querySelector('#tailor-supplement-text').value === '', '载入历史');
  check(document.querySelector('[data-testid="tailor-supplement"]').textContent.includes('已补充 2 轮'), '历史恢复累计补充');
  fill(document.querySelector('#tailor-supplement-text'), '补充丙：纠正测试样本为40条。');
  await wait(() => !button('补充并重新生成').disabled, '历史补充输入'); button('补充并重新生成').click();
  await wait(() => history().find(h => h.jobId === 'a')?.result.supplements?.length === 3, '历史迭代保存');
  await wait(() => !document.querySelector('#tailor-supplement-text').disabled, '历史迭代结束');
  check(history().length === 2 && history().some(h => h.jobId === 'b'), '历史迭代保留身份和另一公司');
  button('批量导出 PDF（2）').click();
  await wait(() => document.querySelector('.resume-export-modal'), '导出窗口');
  const name = document.querySelector('#name'); if (name) fill(name, '示例候选人');
  button('选择目录并批量保存').click();
  await wait(() => window.pdfFiles.length === 2, '导出最新批量数据');
  check(window.pdfFiles[0].html.includes('第3轮补充已纳入知识库项目'), '批量PDF使用迭代后的文档');
  check(!window.pdfFiles[1].html.includes('第3轮补充已纳入知识库项目'), '另一岗位导出独立');
  const close = document.querySelector('.resume-export-modal .ant-modal-close'); if(close) close.click();
  document.querySelector('.tailor-main-card').scrollIntoView({ block: 'start' });
  await new Promise(r => setTimeout(r, 250));
  return checks;
};
writeFileSync(entry, `const {app,BrowserWindow}=require('electron'); const fs=require('fs');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))}); app.setPath('sessionData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1180,height:1000,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_req,cb)=>cb({cancel:true}));
try{await win.loadFile(${JSON.stringify(htmlPath)}); const checks=await win.webContents.executeJavaScript('('+${JSON.stringify(runUi.toString())}+')()');
fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({checks}));fs.writeFileSync(${JSON.stringify(screenshotPath)},(await win.webContents.capturePage()).toPNG());}
catch(error){fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({error:error.stack}));}
finally{win.destroy();app.quit();}});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const proc = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env, windowsHide: true, timeout: 60000, encoding: 'utf8' });
assert.equal(proc.status, 0, proc.error?.message || proc.stderr);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.ok(!report.error, report.error);
console.log(`PASS UI: ${report.checks.length} 项实际页面交互检查。报告：${reportPath}`);
console.log(`页面截图：${screenshotPath}`);
