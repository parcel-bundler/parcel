const Asset = require('../Asset');
const md5 = require('../utils/md5');
const path = require('path');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    return {
      js: `module.exports=${JSON.stringify(md5(this.name) + path.extname(this.name))};`
    };
  }
}

module.exports = RawAsset;
