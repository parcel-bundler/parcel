// @flow

import type {FilePath} from '@parcel/types';

import path from 'path';
import nullthrows from 'nullthrows';

import {Resolver} from '@parcel/plugin';
import NodeResolver from '@parcel/node-resolver-core';
import {glob} from '@parcel/utils';
import {hashString, Hash} from '@parcel/hash';

const NODE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'json'];
function getReactNativeInfixes() {
  // TODO various envs
  return ['android', 'native', ''];
}

function* crossProduct(a, b) {
  for (let aValue of a) {
    for (let bValue of b) {
      if (aValue.length === 0) {
        yield `${bValue}`;
      } else {
        yield `${aValue}.${bValue}`;
      }
    }
  }
}

const SCALE_REGEX = /^(.+?)(@([\d.]+)x)?\.\w+$/;

// https://github.com/facebook/metro/blob/af23a1b27bcaaff2e43cb795744b003e145e78dd/packages/metro/src/Assets.js#L187-L228
// https://github.com/facebook/metro/blob/af23a1b27bcaaff2e43cb795744b003e145e78dd/packages/metro/src/__tests__/Assets-test.js#L202

export default (new Resolver({
  async resolve({dependency, options, specifier, pipeline}) {
    const resolver = new NodeResolver({
      fs: options.inputFS,
      projectRoot: options.projectRoot,
      extensions: [...crossProduct(getReactNativeInfixes(), NODE_EXTENSIONS)],
      mainFields: ['source', 'browser', 'module', 'main'],
    });

    let result = await resolver.resolve({
      filename: specifier,
      specifierType: dependency.specifierType,
      parent: dependency.resolveFrom,
      env: dependency.env,
      sourcePath: dependency.sourcePath,
    });

    const filePath = result?.filePath;
    if (
      pipeline !== 'rn-asset' &&
      result != null &&
      filePath != null &&
      filePath?.endsWith('.png')
    ) {
      const basename = removeExtension(filePath);
      const g = basename + '@*x.png';
      let invalidateOnFileChange = result.invalidateOnFileChange ?? [];
      let invalidateOnFileCreate = result.invalidateOnFileCreate ?? [];
      invalidateOnFileCreate.push({
        glob: g,
      });
      let hash = new Hash();
      let files = [{file: path.basename(filePath), scale: 1}].concat(
        (
          await glob(g, options.inputFS, {
            deep: false,
            onlyFiles: true,
          })
        ).map(file => {
          let [, , , scale] = nullthrows(
            path.basename(file).match(SCALE_REGEX),
          );
          return {file: path.basename(file), scale: Number(scale)};
        }),
      );

      for (let {file} of files) {
        let f = path.join(path.dirname(filePath), file);
        invalidateOnFileChange.push(f);
        hash.writeBuffer(await options.inputFS.readFile(f));
      }

      return {
        filePath: `${basename}.js`,
        code: `
${files
  .map(({file}) => `require(${JSON.stringify('rn-asset:./' + file)});`)
  .join('\n')}

module.exports = require("react-native/Libraries/Image/AssetRegistry").registerAsset({
  __packager_asset: true,
  httpServerLocation: ${JSON.stringify('/')},
  width: ${630},
  height: ${258},
  scales: ${JSON.stringify(files.map(({scale}) => scale))},
  hash: ${JSON.stringify(hash.finish())},
  name: ${JSON.stringify(
    `${path.basename(basename)}.${hashString(
      path.posix.relative(options.projectRoot, filePath),
    )}`,
  )},
  type: "png",
});
`,
        pipeline: 'rn-asset',
        invalidateOnFileCreate,
        invalidateOnFileChange,
      };
    }

    return result;
  },
}): Resolver);

function removeExtension(v: FilePath) {
  return v.substring(0, v.lastIndexOf('.'));
}
