import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
if (probe.status !== 0) console.log('Source archive: Git privacy hooks are installed when using a Git checkout.');
else {
  const old = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (old && old !== '.githooks') throw Error('Existing Git hooks are configured; integrate the privacy checker before pushing.');
  git('config', '--local', 'core.hooksPath', '.githooks');
  const termsFile = path.join(git('rev-parse', '--absolute-git-dir'), 'bossclaw-private-terms.json');
  const terms = fs.existsSync(termsFile) ? JSON.parse(fs.readFileSync(termsFile, 'utf8')) : [];
  const email = spawnSync('git', ['config', '--get', 'user.email'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (email && !email.endsWith('@users.noreply.github.com') && !terms.includes(email)) terms.push(email);
  fs.writeFileSync(termsFile, JSON.stringify(terms), { mode: 0o600 });
  console.log('Privacy hooks installed for commits and pushes. Private terms stay inside .git; author email unchanged.');
}
