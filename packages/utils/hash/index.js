let parts = [process.platform, process.arch];
if (process.platform === 'linux') {
  const {MUSL, family} = require('detect-libc');
  if (family === MUSL) {
    parts.push('musl');
  } else if (process.arch === 'arm') {
    parts.push('gnueabihf');
  } else {
    parts.push('gnu');
  }
} else if (process.platform === 'win32') {
  parts.push('msvc');
}

let name = `./parcel-hash.${parts.join('-')}.node`;
if (process.env.PARCEL_BUILD_ENV === 'production') {
  // ATLASSIAN: Used upstream published builds
  module.exports = require('self-published');
} else if (require('fs').existsSync(require('path').join(__dirname, name))) {
  module.exports = require(name);
} else {
  module.exports = require('self-published');
}

module.exports.init = Promise.resolve();
