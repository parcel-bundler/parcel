// TODO: remove deep import once API is exposed (It is merged to master but not published yet)
const transform = require('doctoc/lib/transform');
const {readFileSync} = require('fs');
const path = require('path');

const README_PATH = path.join(__dirname, '../README.md');

(function() {
  let content = readFileSync(README_PATH, 'utf8');
  let result = transform(content);

  if (content !== result.data) {
    // eslint-disable-next-line no-console
    console.error(
      'Looks like the README table of contents needs to be updated. Please run `yarn update-readme-toc` and commit the README file.'
    );
    process.exit(1);
  }
})();
