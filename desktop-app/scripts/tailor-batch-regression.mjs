import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-batch-test-'));
try {
  const outfile = join(temporary, 'bundle.cjs');
  await build({ stdin: { contents: "export * from './src/lib/bossclaw/tailorBatch'; export * from './src/store/useAppStore'; export * from './src/lib/persistSafe'; export * from './src/lib/localBackup';", resolveDir: root, loader: 'ts' },
    tsconfig: join(root, 'tsconfig.json'), bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent' });
  const require = createRequire(import.meta.url);
  const { createTailorBatch, runTailorBatch, upsertTailorHistory, batchPdfFolderName, useAppStore, markPersistDirty, writeLocalBackup } = require(outfile);
  const pending = ['a', 'b', 'c'].map((id) => ({ id, status: 'pending', job: { title: 'Agent 开发 10-15K', company: id, description: `${id}：Python RAG 工具调用` } }));
  const batch = createTailorBatch(pending, ['b', 'missing', 'a', 'b', 'c']);
  assert.deepEqual(batch.map((item) => item.id), ['b', 'a', 'c']);
  assert.equal(batch[0].job.company, 'b');
  assert.match(batch[0].job.description, /b：Python/);
  let inFlight = 0;
  let maxInFlight = 0;
  const results = [];
  const statuses = new Map();
  await runTailorBatch(batch, async (item) => {
    inFlight++;
    maxInFlight = Math.max(inFlight, maxInFlight);
    await Promise.resolve();
    inFlight--;
    if (item.id === 'a') throw new Error('模拟单岗失败');
    return { method: item.id === 'c' ? 'local' : 'ai' };
  }, { shouldStop: () => false, onUpdate: (item) => statuses.set(item.id, item), onResult: (item) => results.push(item.id) });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(results, ['b', 'c'], '单岗失败不影响后续岗位');
  assert.equal(statuses.get('a').status, 'failed');
  assert.equal(statuses.get('c').status, 'local', '本地回退不得标为 AI 成功');
  let stop = false;
  const stopped = new Map();
  await runTailorBatch(batch, async () => { stop = true; return { method: 'ai' }; }, {
    shouldStop: () => stop, onUpdate: (item) => stopped.set(item.id, item), onResult: () => {},
  });
  assert.equal(stopped.get('b').status, 'done', '停止保留当前已完成结果');
  assert.equal(stopped.get('a').status, 'stopped');
  const retry = [];
  await runTailorBatch([...stopped.values()], async (item) => { retry.push(item.id); return { method: 'ai' }; },
    { shouldStop: () => false, onUpdate: () => {}, onResult: () => {} });
  assert.deepEqual(retry, ['a', 'c'], '继续时不重复生成已有结果');

  let history = [];
  for (let i = 0; i < 40; i++) history = upsertTailorHistory(history, { id: `record${i}`, jobId: `job${i}`, company: `公司${i}`, jobTitle: 'Agent 开发', jobDesc: `要求${i}`, result: {} });
  assert.equal(history.length, 40, '批量同名岗位各自保存，超过原 20 条仍可保留');
  history = upsertTailorHistory(history, { ...history[0], id: 'latest' });
  assert.equal(history.length, 40);
  assert.equal(history[0].id, 'latest');
  const folderName = batchPdfFolderName('../Agent/开发', '甲公司 & 乙', 0);
  const filename = '张三.pdf';
  assert.ok(!folderName.includes('/'));
  assert.ok(folderName.startsWith('001-'));
  useAppStore.getState().openJobAssistant('single');
  useAppStore.getState().openJobAssistantBatch(['a', 'b', 'a']);
  assert.deepEqual(useAppStore.getState().tailorBatchRequest, ['a', 'b']);
  assert.equal(useAppStore.getState().tailorJobRequest, null);
  const persisted = useAppStore.persist.getOptions().partialize(useAppStore.getState());
  assert.ok(!Object.hasOwn(persisted, 'tailorBatchRequest') && !Object.hasOwn(persisted, 'tailorBusy'));
  useAppStore.getState().openJobAssistant('single');
  assert.equal(useAppStore.getState().tailorBatchRequest, null);

  const { validatePdfItem, writeUniquePdf } = require(join(root, 'electron/resume-pdf-batch.cjs'));
  assert.throws(() => validatePdfItem({ fileName: '../escape.pdf', html: '<!DOCTYPE html>' + 'x'.repeat(250) }));
  assert.throws(() => validatePdfItem({ fileName: 'ok.pdf', html: '' }));
  validatePdfItem({ fileName: filename, html: '<!DOCTYPE html>' + 'x'.repeat(250) });
  writeFileSync(join(temporary, '简历.pdf'), '原有文件');
  const writes = await Promise.all(['甲', '乙', '丙'].map((body) => writeUniquePdf(temporary, '简历.pdf', Buffer.from(body))));
  assert.equal(new Set(writes).size, 3, '同名并发输出不能互相覆盖');
  assert.equal(readFileSync(join(temporary, '简历.pdf'), 'utf8'), '原有文件');
  assert.deepEqual(new Set(writes.map((p) => readFileSync(p, 'utf8'))), new Set(['甲', '乙', '丙']));
  await assert.rejects(writeUniquePdf(temporary, '../escape.pdf', Buffer.from('x')));
  assert.equal(readdirSync(temporary).filter((name) => name.endsWith('.pdf')).length, 4);
  assert.throws(() => validatePdfItem({ fileName: filename, folderName: '../escape', html: '<!DOCTYPE html>' + 'x'.repeat(250) }));
  assert.throws(() => validatePdfItem({ fileName: 'CON.pdf', html: '<!DOCTYPE html>' + 'x'.repeat(250) }));
  const separated = await Promise.all(['甲', '乙', '丙'].map(body => writeUniquePdf(temporary, filename, Buffer.from(body), folderName)));
  assert.equal(new Set(separated.map(dirname)).size, 3, '重复及并发导出创建不同岗位目录');
  assert.ok(separated.every(file => basename(file) === filename), '附件文件名始终只用姓名');
  assert.deepEqual(new Set(separated.map(file => readFileSync(file, 'utf8'))), new Set(['甲', '乙', '丙']));
  await assert.rejects(writeUniquePdf(temporary, filename, Buffer.from('x'), '../escape'));
  const stored = new Map([['bossclaw-tailor-history-v1', '旧历史']]);
  const backups = [];
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
  globalThis.window = { electron: { backupWrite: async (text) => { backups.push(JSON.parse(text)); return { ok: true }; } } };
  assert.equal((await writeLocalBackup(true)).wrote, true);
  assert.equal((await writeLocalBackup()).wrote, false);
  stored.set('bossclaw-tailor-history-v1', '新历史');
  markPersistDirty('bossclaw-tailor-history-v1');
  assert.equal((await writeLocalBackup()).wrote, true, '历史直写后下一轮备份不被空闲快路径跳过');
  assert.equal(backups.at(-1).keys['bossclaw-tailor-history-v1'], '新历史');
  console.log('PASS batch: 串行/失败继续/停止续跑、岗位元数据、同名历史、跨页请求、PDF 防覆盖与路径校验。');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
