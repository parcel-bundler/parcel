const Asset = require('../Asset');
const loader = require('graphql-tag/loader');

const dummyLoaderContext = {
  cacheable() {}
};

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async parse(code) {
    return loader.call(dummyLoaderContext, code);
  }

  generate() {
    return this.ast;
  }
}

module.exports = GraphqlAsset;
