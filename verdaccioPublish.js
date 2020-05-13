const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const run = cmd => execSync(cmd, {encoding: 'utf8', cwd: __dirname});
const bin = cmd => path.join(__dirname, 'node_modules/.bin', cmd);

const sha = run('git rev-parse --short HEAD').trim();
const version = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'packages/core/core/package.json'),
    'utf8',
  ),
).version;

try {
  run(
    `${bin(
      'lerna',
    )} version -y --no-push --no-git-tag-version --exact ${version}-${sha}`,
  );

  run(`git add .`);
  run(`git commit -m 'Temp' --no-verify`);

  run(
    `${bin('lerna')} publish -y --registry http://localhost:4000 from-package`,
  );
} finally {
  execSync(`git reset --hard ${sha}`);
}
