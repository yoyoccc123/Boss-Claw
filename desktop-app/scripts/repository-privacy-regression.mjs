// Isolated local Git repositories; no account, recruitment site or public push.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanContent, auditStaged, auditHistory, auditPush } from './repository-privacy-check.mjs';
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const temporary = fs.mkdtempSync(path.join(process.env.BOSSCLAW_TEST_TMP || os.tmpdir(), 'bossclaw-privacy-'));
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const privateName = ['私密', '求职者'].join(''), privateEmail = ['candidate', 'personal.example'].join('@');
const privatePhone = ['139', '12345678'].join('');
const secret = 'sk-' + 'A7x9B2k4T6'.repeat(4);
for (const [file, content, terms] of [
  ['example.ts', privateName, [privateName]], ['example.ts', privateEmail, []], ['example.ts', privatePhone, []],
  ['example.ts', secret, []], ['.local-release/capture.json', '{}', []], ['userData/settings.json', '{}', []],
  ['profile/Cookies.sqlite', 'data', []], ['resume.pdf', '%PDF', []], ['notes.har', '{}', []],
  ['new-photo.png', Buffer.from([1, 0, 3]), []], ['.env', 'PUBLIC=1', []],
]) check(scanContent(file, content, terms).length > 0, 'blocks private fixture: ' + file);
for (const content of ['13800000000', '13800138000', 'sample@example.invalid', '.task-analysis-result-recommend {}'])
  check(scanContent('example.ts', content).length === 0, 'synthetic fixtures and CSS class names do not become credentials');
const repo = path.join(temporary, 'source'), remote = path.join(temporary, 'remote.git');
fs.mkdirSync(repo); const run = (args, options = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', ...options }).trim();
run(['init', '-b', 'main']); run(['config', 'user.name', 'Privacy Fixture']); run(['config', 'user.email', privateEmail]);
run(['init', '--bare', remote]); run(['remote', 'add', 'origin', remote]);
fs.mkdirSync(path.join(repo, 'desktop-app/scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'desktop-app/scripts/repository-privacy-check.mjs'), path.join(repo, 'desktop-app/scripts/repository-privacy-check.mjs'));
fs.copyFileSync(path.join(root, '.gitignore'), path.join(repo, '.gitignore'));
fs.writeFileSync(path.join(repo, '.git/bossclaw-private-terms.json'), JSON.stringify([privateName, privateEmail]));
fs.writeFileSync(path.join(repo, 'sample.ts'), 'export const name = "测试求职者";\n');
run(['add', '.']);
check(auditStaged(repo).length === 0, 'clean staged source passes with a private Git author email');
run(['commit', '-m', 'clean fixture']);
const first = run(['rev-parse', 'HEAD']);
check(auditHistory(repo, first).length === 0, 'Git author email is intentionally preserved, rather than treated as source content');
run(['config', 'core.hooksPath', path.join(root, '.githooks')]);
fs.writeFileSync(path.join(repo, 'sample.ts'), privateName); run(['add', 'sample.ts']);
const blockedCommit = spawnSync('git', ['commit', '-m', 'must not publish a real name'], { cwd: repo, encoding: 'utf8' });
check(blockedCommit.status !== 0 && run(['rev-parse', 'HEAD']) === first, 'real pre-commit hook blocks protected names');
check(!(blockedCommit.stdout + blockedCommit.stderr).includes(privateName), 'hook diagnostics never echo the detected value');
fs.writeFileSync(path.join(repo, 'sample.ts'), 'export const name = "测试求职者";\n'); run(['add', 'sample.ts']);
fs.mkdirSync(path.join(repo, '.local-release')); fs.writeFileSync(path.join(repo, '.local-release/capture.json'), '{}');
run(['add', '-f', '.local-release/capture.json']);
check(auditStaged(repo).some(f => f.file.includes('capture.json')), 'git add --force cannot bypass path protection');
run(['reset', '--', '.local-release/capture.json']);
// Deliberately seed a bad historical commit only inside this isolated test repo.
fs.writeFileSync(path.join(repo, 'sample.ts'), privateName); run(['add', 'sample.ts']);
run(['-c', 'core.hooksPath=', 'commit', '-m', 'isolated unsafe history fixture']);
const unsafe = run(['rev-parse', 'HEAD']);
fs.writeFileSync(path.join(repo, 'sample.ts'), 'export const name = "测试求职者";\n'); run(['add', 'sample.ts']);
run(['commit', '-m', 'remove private fixture from tip']); const tip = run(['rev-parse', 'HEAD']);
check(auditStaged(repo).length === 0 && auditHistory(repo, tip).length > 0, 'removing a value at HEAD cannot hide it in outgoing history');
check(auditPush(repo, `refs/heads/main ${tip} refs/heads/main ${'0'.repeat(40)}\n`).length > 0, 'pre-push audits new-branch history');
check(auditPush(repo, `refs/tags/review ${unsafe} refs/tags/review ${'0'.repeat(40)}\n`).length > 0, 'tags cannot smuggle an old private commit');
check(auditPush(repo, `refs/heads/old ${'0'.repeat(40)} refs/heads/old ${tip}\n`).length === 0, 'remote branch deletion remains possible');
const blockedPush = spawnSync('git', ['push', 'origin', 'main'], { cwd: repo, encoding: 'utf8' });
check(blockedPush.status !== 0 && !run(['ls-remote', '--heads', 'origin']), 'real pre-push hook prevents unsafe history reaching a local remote');
run(['reset', '--hard', first]);
const cleanPush = spawnSync('git', ['push', 'origin', 'main'], { cwd: repo, encoding: 'utf8' });
check(cleanPush.status === 0 && run(['ls-remote', '--heads', 'origin']).includes(first), 'clean history passes the actual pre-push hook');
check(run(['config', 'user.email']) === privateEmail, 'neither checker nor hooks rewrite the requested Git email');
console.log(`PASS repository privacy: ${checks} synthetic content, real commit/push blocking, force-added files, historical leaks and author-email preservation checks; local remotes only.`);
