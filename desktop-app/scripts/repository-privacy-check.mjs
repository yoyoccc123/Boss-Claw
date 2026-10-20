// Repository-only checks. Never read application profiles, cookies or resume storage.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UPSTREAM_BASE = 'cbca44a10846dbdf7b95e5d76e4ef937b1b28b52';
const EXAMPLE_PHONES = new Set(['13800000000', '13800138000']);
const EMAIL = /(?<![\w.])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const PRIVATE_PATH = /(?:^|\/)(?:\.local-release|\.bossclaw|\.jobclaw|userData|Local Storage|Partitions|leveldb|private-resumes)(?:\/|$)|(?:^|\/)\.env(?:\.[^/]+)?$|(?:cookies?|credentials?|secrets?)(?:[-_.][^/]*)?\.(?:json|sqlite|db)$|\.(?:pdf|docx?|har|pem|key)$/i;
const exampleEmail = email => /@(?:[^@.]+\.)*(?:example\.(?:com|org|net)|invalid|test)$/i.test(email)
  || /@users\.noreply\.github\.com$/i.test(email)
  || ['a@b.com', 'c@d.com', 'nc@d.com', 'x@y.com', 'yanquan@bossclaw.dev'].includes(email.toLowerCase());

export function scanContent(filename, raw, privateTerms = []) {
  const findings = [], text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const add = (kind, at = 0) => findings.push({ file: filename, kind, line: text.slice(0, at).split('\n').length });
  if (PRIVATE_PATH.test(filename) && !/(?:^|\/)\.env\.example$/.test(filename)) add('private file or credential storage');
  for (const term of privateTerms) if (typeof term === 'string' && term.length >= 2) {
    const at = text.indexOf(term); if (at >= 0 || filename.includes(term)) add('locally protected personal information', Math.max(at, 0));
  }
  // Images may contain visible personal data. Existing application icons are the
  // only approved binary assets; other binary files require manual sanitization.
  if (text.includes('\0')) {
    if (!/^(?:desktop-app\/(?:resources\/(?:icon\.(?:png|ico)|App_icon_[^/]+\.png)|src\/assets\/bossclaw-icon\.png))$/.test(filename)) add('unreviewed binary artifact');
    return findings;
  }
  for (const m of text.matchAll(/(?<![\w])1[3-9]\d{9}(?![\w])/g)) if (!EXAMPLE_PHONES.has(m[0])) add('possible personal phone number', m.index);
  for (const m of text.matchAll(EMAIL)) if (!exampleEmail(m[0])) add('non-example contact email in source', m.index);
  for (const m of text.matchAll(SECRET)) add('possible credential', m.index);
  for (const m of text.matchAll(/(?:api[_-]?key|access[_-]?token|auth[_-]?token)\s*["']?\s*[:=]\s*["']([^"'\r\n]{20,})["']/gi)) {
    if (!/example|dummy|synthetic|offline|test|process\.env|\$\{|\{\{/i.test(m[1])) add('literal credential value', m.index);
  }
  return findings;
}

export function gitRun(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, ...options });
}
export function loadPrivateTerms(cwd) {
  const directory = gitRun(cwd, ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  const file = path.join(directory, 'bossclaw-private-terms.json');
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value) || value.some(term => typeof term !== 'string')) throw Error('Invalid local privacy terms');
  return value;
}
function nulList(raw) { return raw.toString('utf8').split('\0').filter(Boolean); }
function readObjects(cwd, entries, terms) {
  if (!entries.length) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd, input: entries.map(e => e.oid).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw result.error || Error('Unable to read Git objects');
  const findings = []; let offset = 0;
  for (const entry of entries) {
    const end = result.stdout.indexOf(10, offset);
    const header = result.stdout.subarray(offset, end).toString('ascii').split(' ');
    if (end < 0 || header.length !== 3) throw Error('Invalid Git object response');
    const size = Number(header[2]); offset = end + 1;
    const data = result.stdout.subarray(offset, offset + size); offset += size + 1;
    if (header[1] === 'blob') findings.push(...scanContent(entry.file, data, terms));
  }
  return findings;
}
export function auditStaged(cwd, terms = loadPrivateTerms(cwd)) {
  // Scan the complete staged tree, including previously tracked files; --force
  // adding an ignored private file must never evade this check.
  const entries = nulList(gitRun(cwd, ['ls-files', '--stage', '-z'])).map(line => {
    const tab = line.indexOf('\t'), [mode, oid, stage] = line.slice(0, tab).split(' ');
    if (stage !== '0') throw Error('Resolve merge conflicts before privacy checks');
    return { file: line.slice(tab + 1), oid, mode };
  });
  return readObjects(cwd, entries, terms);
}
export function auditHistory(cwd, revision, terms = loadPrivateTerms(cwd)) {
  const exists = spawnSync('git', ['cat-file', '-e', UPSTREAM_BASE + '^{commit}'], { cwd, stdio: 'ignore' }).status === 0;
  const objects = gitRun(cwd, ['-c', 'core.quotepath=false', 'rev-list', '--objects', revision, ...(exists ? ['--not', UPSTREAM_BASE] : [])], { encoding: 'utf8' });
  const entries = objects.split('\n').filter(Boolean).map(line => {
    const space = line.indexOf(' '); return { oid: space < 0 ? line : line.slice(0, space), file: space < 0 ? '(history)' : line.slice(space + 1) };
  });
  // Intentional Git author/tagger email choices are not inspected or changed.
  // Content, filenames and every new historical blob are checked.
  return readObjects(cwd, entries, terms);
}
export function auditPush(cwd, input, terms = loadPrivateTerms(cwd)) {
  const findings = [], checked = new Set();
  for (const row of input.trim().split(/\r?\n/).filter(Boolean)) {
    const fields = row.split(/\s+/); if (fields.length !== 4) throw Error('Invalid pre-push input');
    const oid = fields[1]; if (/^0+$/.test(oid) || checked.has(oid)) continue;
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw Error('Invalid pushed object');
    checked.add(oid); findings.push(...auditHistory(cwd, oid, terms));
  }
  return findings;
}
const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  try {
    const cwd = process.cwd(), args = process.argv.slice(2);
    const findings = args[0] === '--staged' ? auditStaged(cwd)
      : args[0] === '--pre-push' ? auditPush(cwd, fs.readFileSync(0, 'utf8'))
      : auditHistory(cwd, args[1] || 'HEAD');
    if (findings.length) {
      console.error('Privacy check blocked this operation. Remove personal data or use synthetic fixtures.');
      for (const f of findings.slice(0, 40)) console.error(`${f.file}:${f.line}: ${f.kind}`);
      console.error('Detected values are deliberately omitted. Git author email is unchanged.');
      process.exitCode = 1;
    } else console.log('PASS repository privacy: source and private artifacts checked; no sensitive values printed.');
  } catch (error) { console.error('Privacy check could not complete; operation blocked: ' + error.message); process.exitCode = 1; }
}
