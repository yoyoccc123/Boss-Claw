'use strict';
const fs = require('node:fs'), path = require('node:path');
const { build } = require('esbuild');
exports.default = async context => {
  const root = context.packager.projectDir;
  const output = path.join(path.resolve(process.env.BOSSCLAW_BUILD_ROOT || 'E:/BossClaw-build'), 'assets', 'bridge');
  fs.mkdirSync(output, { recursive: true });
  await build({ entryPoints: [path.join(root, 'bridge/server.cjs')], bundle: true, platform: 'node', format: 'cjs',
    outfile: path.join(output, 'server.cjs'), logLevel: 'warning' });
  fs.copyFileSync(path.join(root, 'bridge/config.json'), path.join(output, 'config.json'));
};
