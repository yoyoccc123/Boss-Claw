import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url))), temporary = mkdtempSync(join(tmpdir(), 'bossclaw-send-evidence-'));
const bundle = join(temporary, 'evidence.cjs');
await build({ stdin: { contents: "export * from './src/lib/bossclaw/deliveryEvidence';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { repairUnconfirmedDeliveries } = createRequire(import.meta.url)(bundle);
const items = [
  { status: 'failed', error: '未能确认文字气泡已发送，请人工核对后重试' },
  { status: 'failed', error: 'ordinary failure' },
  { status: 'sent', error: '' },
  { status: 'failed', riskBlocked: true, greetingSendAttempted: true },
];
const repaired = repairUnconfirmedDeliveries(items);
assert.ok(repaired[0].deliveryNeedsReview && !repaired[0].retryable && repaired[0].status === 'failed');
assert.ok(repaired.slice(1).every((item, i) => item === items[i + 1]));
assert.ok(!items[0].deliveryNeedsReview, 'migration preserves its input');
assert.deepEqual(repairUnconfirmedDeliveries(repaired), repaired);
const interrupted = repairUnconfirmedDeliveries([{ status: 'approved_queue', greetingSendAttempted: true }])[0];
assert.ok(interrupted.status === 'failed' && interrupted.deliveryNeedsReview && !interrupted.retryable, 'restart cannot resend an interrupted issued send');
const script = join(temporary, 'camoufox-evidence.py');
writeFileSync(script, `import ast,types,contextlib
from pathlib import Path
tree=ast.parse(Path(${JSON.stringify(join(root, 'camoufox/camoufox_server.py'))}).read_text(encoding='utf-8-sig'))
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('chat_greeting','_send_chat_text')]
class Keyboard:
 def __init__(self): self.keys=[]
 def press(self,key): self.keys.append(key)
class Button:
 def click(self): raise TimeoutError('click issued but ack late')
page=types.SimpleNamespace(url='https://www.zhipin.com/web/geek/chat',context=object(),keyboard=Keyboard(),goto=lambda *a,**kw:None,evaluate=lambda *a,**kw:True,bring_to_front=lambda:None)
input_el=types.SimpleNamespace(click=lambda:None)
ns={'GREETING_MIN_LEN':8,'log':lambda *a:None,'human_sleep':lambda *a:None,'load_cookies':lambda:[], 'save_cookies':lambda *a:None,
 'open_browser':lambda **kw:contextlib.nullcontext(page),'_risk_text_hit':lambda p:False,'_external_apply_hit':lambda p:False,
 '_enter_chat':lambda p:(p,input_el),'_chat_header_identity':lambda *a,**kw:{},'_chat_target_error':lambda *a:None,
 '_read_hr_friend_context':lambda p:{'count':0},'_find_chat_input':lambda p:input_el,'_outgoing_message_fingerprints':lambda p:[],
 'type_greeting_human':lambda *a:None,'_input_text':lambda p:'这是需要核对的完整工作台招呼语', '_find_send_button':lambda p:(Button(),'button'),
 '_confirm_message':lambda *a:True}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'production_send','exec'),ns)
result=ns['_send_chat_text'](page,'这是需要核对的完整工作台招呼语',{})
assert result['ok'] and 'Enter' not in page.keyboard.keys, 'late click ack must verify once without pressing Enter again'
ns['_confirm_message']=lambda *a:False
result=ns['_send_chat_text'](page,'这是需要核对的完整工作台招呼语',{})
assert not result['ok'] and result['needsReview'] and result['sendAttempted']
send_result={'ok':True,'sentVia':'button'}
ns['_send_chat_text']=lambda *a:dict(send_result)
ns['_find_chat_input']=lambda p:None
result=ns['chat_greeting']('job-A','这是需要核对的完整工作台招呼语',send_online_resume=True)
assert result['ok'] and result['sent'] and result['textConfirmed'] and result['attachmentWarning'], result
send_result={'ok':False,'code':501,'needsReview':True,'sendAttempted':True,'message':'unknown receipt'}
result=ns['chat_greeting']('job-A','这是需要核对的完整工作台招呼语')
assert not result['ok'] and not result['sent'] and result['needsReview'], result
print('PASS Python send evidence: actual production functions; late click ack, missing receipt, attachment partial failure; no browser/network.')
`);
const python = spawnSync(process.env.BOSSCLAW_PYTHON || 'python', [script], { encoding: 'utf8', timeout: 20000, windowsHide: true });
assert.equal(python.status, 0, python.error?.message || python.stderr);
console.log(python.stdout.trim());
console.log('PASS delivery evidence migration: historical unknown receipts become review, never fabricated success.');
