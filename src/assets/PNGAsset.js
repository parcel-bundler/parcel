const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class PNGAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.outputCode = null;
    this.encoding = null;
  }

  async transform() {
    if (this.options.minify) {
      const minifier = new (await localRequire('pngquant', this.name))([
        256,
        '--strip',
        '--quality',
        '70-90'
      ]);
      const minifiedResult = new Promise((resolve, reject) => {
        const buffers = [];
        minifier.on('error', err => reject(err));
        minifier.on('data', chunk => buffers.push(Buffer.from(chunk)));
        minifier.on('end', () => resolve(Buffer.concat(buffers)));
      });
      minifier.write(this.contents);
      minifier.end();

      this.outputCode = await minifiedResult;
    }
  }

  generate() {
    return {
      png: this.outputCode || this.contents
    };
  }
}

module.exports = PNGAsset;
