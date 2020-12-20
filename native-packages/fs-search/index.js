const fs = require('fs');

let parts = [process.platform, process.arch];
if (process.platform === 'linux') {
  if (fs.existsSync('/etc/alpine-release')) {
    parts.push('musl');
  } else if (process.arch === 'arm') {
    parts.push('gnueabihf');
  } else {
    parts.push('gnu');
  }
} else if (process.platform === 'win32') {
  parts.push('msvc');
}

module.exports = require(`./fs-search.${parts.join('-')}.node`);
