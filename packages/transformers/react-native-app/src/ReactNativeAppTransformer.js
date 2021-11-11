// @flow

import {Transformer} from '@parcel/plugin';

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {relativePath} from '@parcel/utils';

export default (new Transformer({
  async transform({asset}) {
    let code;
    let platform = asset.query.get('platform');
    if (platform) {
      let appJson = JSON.parse(await asset.getCode());
      // TODO appJson.enableHermes could influence browserslist
      let env = {
        engines: asset.env.engines,
        includeNodeModules: asset.env.includeNodeModules,
        outputFormat: asset.env.outputFormat,
        sourceType: asset.env.sourceType,
        isLibrary: asset.env.isLibrary,
        shouldOptimize: asset.env.shouldOptimize,
        shouldScopeHoist: asset.env.shouldScopeHoist,
        sourceMap: asset.env.sourceMap,
        loc: asset.env.loc,
      };
      if (platform === 'android') {
        asset.setEnvironment({
          ...env,
          context: 'react-native-android',
        });
      } else if (platform === 'ios') {
        asset.setEnvironment({
          ...env,
          context: 'react-native-ios',
        });
      } else {
        invariant(false);
      }

      let entryPoint = nullthrows(appJson.entryPoint);
      let appJsonDir = path.dirname(asset.filePath);
      code = `
import '@react-native/polyfills/console.js';
import '@react-native/polyfills/error-guard.js';
import '@react-native/polyfills/Object.es8.js';
import 'react-native/Libraries/Core/InitializeCore.js';
import ${JSON.stringify(
        relativePath(appJsonDir, path.resolve(appJsonDir, entryPoint)),
      )};
`;
      asset.setCode(code);
      asset.type = 'js';
    } else {
      let basename = path.basename(asset.filePath);
      code = `
<script src=${JSON.stringify(`./${basename}?platform=android`)} type="module">
</script>
<script src=${JSON.stringify(`./${basename}?platform=ios`)} type="module">
</script>
`;
      asset.setCode(code);
      asset.type = 'html';
    }

    return [asset];
  },
}): Transformer);
