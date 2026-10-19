// Print synthetic documents through the production Electron renderer; no platform/user data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

export async function verifyPdfMetadata(htmls, temporary) {
  const require = createRequire(import.meta.url), root = dirname(dirname(fileURLToPath(import.meta.url)));
  const source = ts.createSourceFile('main.cjs', readFileSync(join(root, 'electron/main.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [];
  ts.forEachChild(source, node => { if (ts.isFunctionDeclaration(node) && ['withTimeout', 'renderResumePdf'].includes(node.name?.text)) functions.push(node.getText(source)); });
  assert.equal(functions.length, 2);
  const input = join(temporary, 'print-input.json'), entry = join(temporary, 'print-main.cjs'), report = join(temporary, 'print-report.json');
  writeFileSync(input, JSON.stringify(htmls));
  writeFileSync(entry, `const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',${JSON.stringify(join(temporary, 'print-profile'))});
app.setPath('sessionData',${JSON.stringify(join(temporary, 'print-profile'))});
app.on('window-all-closed',()=>{});
${functions.join('\n')}
app.whenReady().then(async()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
try{const files=[];for(const [i,html] of JSON.parse(fs.readFileSync(${JSON.stringify(input)},'utf8')).entries()){const file=path.join(${JSON.stringify(temporary)},'metadata-'+i+'.pdf');fs.writeFileSync(file,await renderResumePdf(html));files.push(file);}fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({files}));}
catch(e){fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.stack}));process.exitCode=1;}finally{app.quit();}});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawnSync(process.env.BOSSCLAW_ELECTRON || require('electron'), [entry], { env, windowsHide: true, timeout: 90000, encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.error?.message || proc.stderr);
  const result = JSON.parse(readFileSync(report, 'utf8')); assert.ok(!result.error, result.error);
  for (const file of result.files) {
    const info = spawnSync(process.env.BOSSCLAW_PDFINFO || 'pdfinfo', ['-enc', 'UTF-8', file], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    assert.equal(info.status, 0, info.error?.message || info.stderr);
    assert.equal(info.stdout.match(/^Title:\s*(.*)$/m)?.[1].trim(), '测试求职者', 'actual PDF metadata Title contains only the name');
  }
  console.log(`PASS real PDF metadata: ${result.files.length} templates, production printToPDF, exact name-only Title; network blocked.`);
}
