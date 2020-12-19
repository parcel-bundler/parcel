const fs = require('fs');

let parts = [process.platform, process.arch];
if (process.platform === 'linux') {
  parts.push(
    fs.existsSync('/etc/alpine-release') ? 'musl' : 'gnu'
  );
} else if (process.platform === 'win32') {
  parts.push('msvc');
}

module.exports = require(`./fs-search.${parts.join('-')}.node`);
