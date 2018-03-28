const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class GraphqlAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.parserDependencies = ['graphql-tag'];
  }

  async parse(code) {
    let gql = localRequire('graphql-tag', this.name);
    return gql(code);
  }

  generate() {
    return {
      js: `module.exports=${JSON.stringify(this.ast, false, 2)};`
    };
  }
}

module.exports = GraphqlAsset;
