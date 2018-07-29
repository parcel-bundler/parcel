const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

const dummyLoaderContext = {
  cacheable() {}
};

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async parse(code) {
    const loader = await localRequire('graphql-tag/loader', this.name);
    return loader.call(dummyLoaderContext, code);
  }

  generate() {
    return this.ast;
  }
}

module.exports = GraphqlAsset;
