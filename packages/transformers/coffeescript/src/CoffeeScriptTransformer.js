import {Transformer} from '@parcel/plugin';
import coffee from 'coffeescript';
import semver from 'semver';
import nullthrows from 'nullthrows';

export default new Transformer({
  canReuseAST({ast}) {
    return (
      ast.type === 'coffeescript' && semver.satisfies(ast.version, '^2.0.0')
    );
  },

  async parse({asset}) {
    return {
      type: 'coffeescript',
      version: '2.0.3',
      program: coffee.nodes(await asset.getCode())
    };
  },

  async transform({asset}) {
    asset.type = 'js';

    return [asset];
  },

  async generate({asset}) {
    const ast = nullthrows(asset.ast);

    return {
      code: ast.program.compile()
    };
  }
});
