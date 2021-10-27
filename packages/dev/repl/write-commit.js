// @flow
const child_process = require('child_process');
const path = require('path');
const fs = require('fs');

let file = path.join(__dirname, 'commit');

let oldCommit = fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim();

const newCommit = child_process
  .execSync('git merge-base v2 HEAD', {encoding: 'utf8'})
  // .execSync('git rev-parse HEAD', {encoding: 'utf8'})
  .trim();

if (oldCommit !== newCommit) {
  fs.writeFileSync(file, newCommit);
}
