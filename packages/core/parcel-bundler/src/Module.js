const traverse = require('babel-traverse').default;
const types = require('babel-types');
const path = require('path');
const collectDependencies = require('./visitors/dependencies');
const walk = require('babylon-walk');

class Module {
  constructor(name, options = {}) {
    this.name = name;
    this.basename = path.basename(this.name, path.extname(this.name));
    this.code = null;
    this.ast = null;
    this.options = options;

    this.dependencies = new Set;
    this.modules = new Map;
  }

  async load() {

  }

  traverse(visitor) {
    return walk.simple(this.ast, visitor, this);
  }

  collectDependencies() {
    this.traverse(collectDependencies);
  }
}

module.exports = Module;
