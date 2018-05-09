const GraphqlAsset = {
  type: 'js',

  async parse(code, state) {
    let gql = await state.require('graphql-tag');
    return gql(code);
  },

  generate(ast) {
    return {
      js: `module.exports=${JSON.stringify(ast, false, 2)};`
    };
  }
};

module.exports = {
  Asset: {
    gql: GraphqlAsset,
    graphql: GraphqlAsset
  }
};
