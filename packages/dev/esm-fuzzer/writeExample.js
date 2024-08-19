const fs = require('fs');
const path = require('path');

const EXAMPLE = {
  /*...*/
};

let BASEDIR = '...';

for (let [name, code] of Object.entries(EXAMPLE.files)) {
  fs.writeFileSync(path.join(BASEDIR, 'src', name), code);
}

console.log(`atlaspack2 build ${EXAMPLE.entries.join(' ')}`);
