const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async parse(code) {
    let gql = await localRequire('graphql-tag', this.name);
    return gql(code);
  }

  generate() {
    return `module.exports=${JSON.stringify(this.ast, false, 2)};`;
  }
}

module.exports = GraphqlAsset;
