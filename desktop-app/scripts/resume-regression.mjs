// 离线检查精简文档的事实来源、历史内容兼容，以及全部 PDF 模板的顺序和文本转义。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-resume-test-'));
try {
  const outfile = join(temporary, 'bundle.cjs');
  await build({
    stdin: {
      contents: "export * from './src/lib/bossclaw/jobAssistant'; export * from './src/lib/bossclaw/resumeContact'; export * from './src/lib/bossclaw/resumePdf';",
      resolveDir: root, loader: 'ts',
    },
    tsconfig: join(root, 'tsconfig.json'), bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent',
  });
  const { normalizeTailorDoc, buildResumeDocData, buildResumeHtml, RESUME_TEMPLATES } = createRequire(import.meta.url)(outfile);
  const line = (text) => ({ text, source: `原文摘录：${text}` });
  const raw = {
    projects: Array.from({ length: 5 }, (_, i) => ({
      heading: `项目${i + 1}`, meta: '参与开发',
      bullets: Array.from({ length: 6 }, (_, j) => line(`参与实现功能${j + 1}`)),
    })),
    skills: [line('后端：熟悉 Python'), line('后端： 熟悉 python'), '', line('接口：了解 FastAPI'), line('检索：熟悉 RAG'), line('工具：了解 Git'), line('其他：了解 Vue')],
    education: [{ heading: '示例大学', meta: '本科', bullets: [] }],
    selfEval: line('人工智能专业本科在读，参与智能助手项目。'),
  };
  const doc = normalizeTailorDoc(raw);
  assert.equal(doc.projects.length, 3, '新结果只保留模型排序的前三个项目');
  assert.ok(doc.projects.every((p) => p.bullets.length === 3));
  assert.deepEqual(doc.projects[0].bullets[0], raw.projects[0].bullets[0], '精简仍须保留职责和原文来源');
  assert.equal(doc.skills.length, 4, '重复/空技能不占分组额度');
  assert.equal(doc.skills[3].text, '工具：了解 Git');
  assert.deepEqual(normalizeTailorDoc(null).projects, []);

  // 历史文档不经过新的数量裁剪，导出仍保留用户勾选的所有事实。
  const historical = { ...raw, internships: [], works: [], honors: [] };
  assert.equal(buildResumeDocData('', null, { doc: historical }, {}, []).modules.length, 0, '取消全部模块时不能重新输出所有内容');
  const data = buildResumeDocData('', null, { doc: historical }, { name: '张三 <script>', targetTitle: 'Agent 开发', phone: '13800000000', email: 'resume@example.invalid' }, ['selfEval', 'skills', 'projects', 'education']);
  assert.equal(data.modules.find((m) => m.id === 'projects').blocks.length, 5);
  assert.equal(data.modules.find((m) => m.id === 'projects').blocks[0].bullets.length, 6);
  for (const template of RESUME_TEMPLATES) {
    const html = buildResumeHtml(data, template.id);
    assert.ok(html.includes('张三 &lt;script&gt;'));
    assert.equal((html.match(/联系电话/g) || []).length, 1, `${template.id} 显示联系电话标签`);
    assert.equal((html.match(/邮箱/g) || []).length, 1, `${template.id} 显示邮箱标签`);
    assert.ok(!html.includes('<script>'), '文字不得成为可执行 HTML');
    assert.ok(!html.includes('原文摘录：'), '事实核对来源不进入投递正文');
    assert.ok(!html.includes('class="photo-box"'), '未上传照片不出现照片框');
    const sectionIds = [...html.matchAll(/<section[^>]*data-section="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sectionIds, ['selfEval', 'skills', 'projects', 'education'], `${template.id} 尊重导出模块顺序`);
    assert.ok(html.includes('项目5'), `${template.id} 不隐式删改历史项目`);
  }
  const paired = buildResumeHtml(data, 'focus');
  assert.ok(paired.includes('<div class="focus-overview">'));
  const separated = buildResumeHtml({ ...data, modules: [data.modules[0], data.modules[2], data.modules[1]] }, 'focus');
  assert.ok(!separated.includes('<div class="focus-overview">'), '简介和技能不相邻时不强行移动模块');
  assert.ok(!buildResumeHtml({ ...data, modules: [data.modules[2]] }, 'focus').includes('个人简介'));
  const personal = buildResumeHtml(data);
  assert.ok(personal.includes('class="tpl-personal"'));
  assert.ok(personal.includes('font-size:12pt'));
  assert.ok(personal.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(personal.includes('重点项目经历'));
  assert.ok(personal.includes('专业技能'), '个人模板保留专业技能模块标题');
  assert.ok(buildResumeHtml(data, 'unknown').includes('class="tpl-personal"'));
  console.log('PASS resume: 精简上限/来源、技能去重、历史兼容、个人模板与六套可选模板顺序与转义。');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
