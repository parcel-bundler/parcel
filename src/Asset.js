const Parser = require('./Parser');
const path = require('path');
const fs = require('./utils/fs');

class Asset {
  constructor(name, options) {
    this.name = name;
    this.basename = path.basename(this.name, path.extname(this.name));
    this.options = options;
    this.encoding = 'utf8';

    this.contents = null;
    this.ast = null;
    this.dependencies = new Set;
    this.modules = new Map;
  }

  async loadIfNeeded() {
    if (!this.contents) {
      this.contents = await fs.readFile(this.name, this.encoding);
    }
  }

  async parseIfNeeded() {
    await this.loadIfNeeded();
    if (!this.ast) {
      this.ast = this.parse(this.contents);
    }
  }

  async getDependencies() {
    await this.parseIfNeeded();
    this.collectDependencies();
  }

  parse() {
    // do nothing by default
  }

  collectDependencies() {
    // do nothing by default
  }
}

module.exports = Asset;
