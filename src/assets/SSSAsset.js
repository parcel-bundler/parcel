const postcss = require('postcss');
const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');

class SSSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async generate() {
    let sugarss = await localRequire('sugarss', this.name);

    await this.loadIfNeeded();

    let {css} = await postcss().process(this.contents, {
      from: this.name,
      to: this.name,
      parser: sugarss
    });

    return [
      {
        type: 'css',
        value: css
      }
    ];
  }
}

module.exports = SSSAsset;
