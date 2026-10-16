import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { OWNER, assertSafeChild } = createRequire(import.meta.url)('./release-policy.cjs');
export async function smokePackaged({ packaged, fixture, electron, env, run }) {
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, '.bossclaw-owned.json'), JSON.stringify({ owner: OWNER, kind: 'smoke' }));
  const profile = path.join(fixture, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, '.bossclaw-data-version'), 'v3-rebuild-20260815');
  const seedHtml = path.join(fixture, 'old-unpacked-origin.html');
  fs.writeFileSync(seedHtml, '<!doctype html><html><body>Offline storage compatibility fixture</body></html>');
  const pythonResume = '离线示例姓名\n教育背景\n示例大学｜人工智能｜本科\n个人简介\n独立编写 Python 自动化脚本，处理 CSV 和 Excel 数据，完成清洗、去重及格式转换。\n专业技能\nPython、requests、OpenCV、MySQL。\n工作经历\n示例公司｜Python 开发实习生\n维护内部数据处理脚本，补充异常处理和运行日志。\n项目经历\n视觉自动化实验\n个人技术实践｜Python / OpenCV\n完成数据标注、模型训练和检测效果验证。';
  const aiResume = pythonResume.replace('独立编写 Python 自动化脚本，处理 CSV 和 Excel 数据，完成清洗、去重及格式转换。', '借助 AI 编程工具完成产品原型搭建与迭代，接触 FastAPI、LangChain、RAG 和大模型 API。');
  const keys = {
    'bossclaw-data-version': 'v3-rebuild-20260815',
    'bossclaw-app': JSON.stringify({ state: { autoAssist: false, activeRoute: 'workbench', engineStatus: 'stopped', theme: 'light' } }),
    'bossclaw-schedule': JSON.stringify({ state: { entries: [] } }),
    'bossclaw-data': JSON.stringify({ version: 2, state: {
      resumeText: pythonResume, resumeFileName: 'fixture.txt', resumeVariants: [
        { id: 'python', kind: 'python', name: 'Python版', text: pythonResume, fileName: 'python.txt', updatedAt: 1 },
        { id: 'ai', kind: 'ai_application', name: 'AI应用版', text: aiResume, fileName: 'ai.txt', updatedAt: 1 },
      ], defaultResumeVariantId: 'python', autoResumeRouting: true,
      pending: [{ id: 'offline-job', status: 'pending', createdAt: Date.now(), deliveryGreeting: '离线发布流程验证，不发送。',
        job: { platform: 'boss', jobId: 'offline-job', title: '离线岗位', company: '离线样例', url: 'https://example.invalid/job' },
        analysis: { decision: 'warn', score: 50, hardBlocks: [] } }],
    } }),
  };
  const seed = path.join(fixture, 'seed.cjs');
  fs.writeFileSync(seed, [
    "const {app,BrowserWindow}=require('electron');",
    "app.setName('BossClaw');app.setPath('userData'," + JSON.stringify(profile) + ");app.setPath('sessionData'," + JSON.stringify(profile) + ");",
    "app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});",
    "try{await w.loadFile(" + JSON.stringify(seedHtml) + ");await w.webContents.executeJavaScript(" +
      JSON.stringify("(()=>{for(const [k,v]of Object.entries(" + JSON.stringify(keys) + "))localStorage.setItem(k,v);})()") + ");}finally{w.destroy();app.quit();}});",
  ].join('\n'));
  await run(electron, [seed], { env });
  const smokeEnv = { ...env, BOSSCLAW_RELEASE_SMOKE_DIR: fixture, BOSSCLAW_DEBUG: '0', BOSSCLAW_CONTROL: '0' };
  await run(path.join(packaged, 'BossClaw.exe'), [], { env: smokeEnv });
  const result = JSON.parse(fs.readFileSync(path.join(fixture, 'smoke-result.json')));
  assert.ok(result.success, result.error);
  const wubaExternal = path.join(packaged, 'resources/camoufox/platforms/wuba-dom.cjs');
  const wubaPreload = path.join(packaged, 'resources/app.asar.unpacked/electron/preload/wuba.cjs');
  assert.ok(fs.readFileSync(wubaExternal).equals(fs.readFileSync(wubaPreload)), '58 DOM rules must match between Python and webview resources');
  result.wubaRulesShared = true;
  // Python must see real files, not the virtual ASAR filesystem.
  const pythonRoot = path.join(packaged, 'resources/camoufox');
  await run(env.BOSSCLAW_PYTHON || 'python', ['-c',
    "import ast,pathlib,sys; r=pathlib.Path(" + JSON.stringify(pythonRoot) + "); files=list(r.rglob('*.py')); assert files; [ast.parse(p.read_text(encoding='utf-8-sig')) for p in files]; pathlib.Path.home=staticmethod(lambda:pathlib.Path(" + JSON.stringify(path.join(fixture, 'python-profile')) + "));sys.path.insert(0,str(r));from platforms.wuba import build_search_url;assert 'zs.58.com' in build_search_url('Python','中山');print('PASS external Python resources and 58 shared module:',len(files))"], { env });
  result.wubaPythonLoaded = true;
  // The child Node bridge must resolve DOCX support without archive-relative require paths.
  const bridgeDir = path.join(packaged, 'resources/bridge'), dataDir = path.join(fixture, 'bridge-data');
  assertSafeChild(fixture, dataDir);
  const bridge = spawn(path.join(packaged, 'BossClaw.exe'), [path.join(bridgeDir, 'server.cjs')], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', BOSSCLAW_DATA_DIR: dataDir, BOSSCLAW_BRIDGE_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('Bundled bridge startup timed out')), 10000);
      bridge.on('error', e => { clearTimeout(timer); reject(e); });
      bridge.stdout.on('data', chunk => { text += chunk; const m = text.match(/listening on 127\.0\.0\.1:(\d+)/);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
      bridge.on('exit', code => { clearTimeout(timer); reject(Error('Bundled bridge exited: ' + code)); });
    });
    const config = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'config.json')));
    const base = 'http://127.0.0.1:' + port;
    const suffix = '?token=' + encodeURIComponent(config.token);
    const response = await fetch(base + '/status' + suffix);
    assert.ok(response.ok, 'Bundled Node bridge health check failed');
    result.bridgeStarted = true;
    const docx = path.join(fixture, 'fixture.docx');
    await run(env.BOSSCLAW_PYTHON || 'python', ['-c',
      "import zipfile; z=zipfile.ZipFile(" + JSON.stringify(docx) + ",'w'); z.writestr('[Content_Types].xml','<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>'); z.writestr('word/document.xml','<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Offline Python application resume fixture with sufficient meaningful content for the release parser check.</w:t></w:r></w:p></w:body></w:document>'); z.close()"], { env });
    const parsed = await (await fetch(base + '/resume-text' + suffix, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'fixture.docx',
        dataUrl: 'data:application/octet-stream;base64,' + fs.readFileSync(docx).toString('base64') }) })).json();
    assert.ok(parsed.ok && parsed.method === 'mammoth' && parsed.text.includes('Offline Python application'), 'Bundled mammoth DOCX parsing failed');
    result.bridgeDocxParsed = true;
  } finally { bridge.kill(); }
  return result;
}
