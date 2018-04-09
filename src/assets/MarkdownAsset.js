const Asset = require('../Asset');

class MarkdownAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return code.replace(/`/g, '\\`');
  }

  generate() {
    const code = `module.exports = ${
      this.ast ? JSON.stringify(this.ast, null, 2) : this.contents
    };`;

    return {
      js: code
    };
  }
}

module.exports = MarkdownAsset;
