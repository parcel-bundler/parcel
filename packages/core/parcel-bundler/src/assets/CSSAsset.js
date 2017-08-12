const Asset = require('../Asset');

class CSSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
  }

  // parse(code) {

  // }

  // collectDependencies() {

  // }

  // async transform() {

  // }

  generate() {
    return {
      css: this.contents,
      js: ''
    };
  }
}

module.exports = CSSAsset;
