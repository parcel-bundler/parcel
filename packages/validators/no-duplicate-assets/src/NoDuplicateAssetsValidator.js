// @flow
import {Validator} from '@parcel/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@parcel/diagnostic';
import invariant from 'assert';
import path from 'path';

let assetNoDupPath = 'nodup.js';

// only do this in prod?
export default (new Validator({
  validateBundles({bundleGraph, options}) {
    //should be async ?
    let validatorResult = {
      warnings: [],
      errors: [],
    };
    let duplicateAsset;
    bundleGraph.traverse(node => {
      if (node.type !== 'asset') {
        return;
      }
      if (
        node.value.filePath === path.join(options.projectRoot, assetNoDupPath)
      ) {
        duplicateAsset = node.value;
      }
    });
    if (duplicateAsset) {
      let bundlesWithAsset = bundleGraph.getBundlesWithAsset(duplicateAsset);
      if (bundlesWithAsset.length > 0) {
        validatorResult.errors.push({
          origin: '@parcel/validator-no-duplicate-assets',
          message: `Found duplicate asset **${assetNoDupPath}** in ${bundlesWithAsset
            .map(b => b.filePath)
            .join(', ')}`,
        });
      }
    } else {
      validatorResult.warnings.push({
        origin: '@parcel/validator-no-duplicate-assets',
        message: `Unable to find asset at filepath **${assetNoDupPath}**`,
      });
    }

    return validatorResult;
  },
}): Validator);
