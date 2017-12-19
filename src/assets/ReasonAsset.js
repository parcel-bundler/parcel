const bsb = require('bsb-js');
const fs = require('fs');
const JSAsset = require('./JSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class ReasonAsset extends JSAsset {
  async parse(code) {
    // This runs BuckleScript - the Reason to JS compiler.
    // Other Asset types use `localRequire` but the `bsb-js` package already
    // does that internally. This should also take care of error handling in
    // the Reason compilation process.
    await bsb.runBuild();

    this.contents = await new Promise((resolve, reject) => {
      // This is a simplified use-case for Reason - it only loads the most
      // common configuration.
      fs.readFile(this.name.replace(/\.re$/, '.bs.js'), (err, contents) => {
        if (err) {
          reject(err);
        } else {
          resolve(contents.toString());
        }
      });
    });

    // After loading the compiled JS source, use the normal JS behavior.
    return await super.parse(this.contents);
  }
}

module.exports = ReasonAsset;
