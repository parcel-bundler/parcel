const bsb = require('bsb-js');
const fs = require('fs');
const JSAsset = require('./JSAsset');
const promisify = require('../utils/promisify');
const readFile = promisify(fs.readFile);

class ReasonAsset extends JSAsset {
  async parse(code) {
    // This runs BuckleScript - the Reason to JS compiler.
    // Other Asset types use `localRequire` but the `bsb-js` package already
    // does that internally. This should also take care of error handling in
    // the Reason compilation process.
    if (process.env.NODE_ENV !== 'test') {
      await bsb.runBuild();
    }

    // This is a simplified use-case for Reason - it only loads the recommended
    // BuckleScript configuration to simplify the file processing.
    const outputFile = this.name.replace(/\.(re|ml)$/, '.bs.js');
    const outputContent = await readFile(outputFile);
    this.contents = outputContent.toString();

    // After loading the compiled JS source, use the normal JS behavior.
    return await super.parse(this.contents);
  }
}

module.exports = ReasonAsset;
