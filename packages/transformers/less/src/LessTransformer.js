// @flow

import {Transformer} from '@parcel/plugin';
import localRequire from '@parcel/local-require';
import {isGlob, glob} from '@parcel/utils';

export default new Transformer({
  async getConfig({asset}) {
    return asset.getConfig(['.lessrc', '.lessrc.js'], {
      packageKey: 'less'
    });
  },

  async transform({asset, config}) {
    const less = await localRequire('less', asset.filePath);
    const code = await asset.getCode();
    const output = await less.render(code, {
      ...(config || {}),
      filename: asset.filePath,
      plugins: [...((config && config.plugins) || []), urlPlugin({asset})]
    });

    asset.type = 'css';
    asset.setCode(output.css);
    asset.meta.hasDependencies = false;
    return [asset];
  }
});

function urlPlugin({asset}) {
  return {
    install(less, pluginManager) {
      const visitor = new less.visitors.Visitor({
        visitUrl(node) {
          node.value.value = asset.addURLDependency(
            node.value.value,
            node.currentFileInfo.filename
          );
          return node;
        }
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    }
  };
}
