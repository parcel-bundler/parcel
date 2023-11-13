// @flow strict-local
import {Optimizer} from '@parcel/plugin';
import {parse, print} from '@swc/core';
import {RequireInliningVisitor} from './RequireInliningVisitor';
import type {SideEffectsMap} from './types';
import nullthrows from 'nullthrows';

let publicIdToAssetSideEffects = null;

type BundleConfig = {|
  publicIdToAssetSideEffects: Map<string, SideEffectsMap>,
|};

// $FlowFixMe not sure how to anotate the export here to make it work...
module.exports = new Optimizer<empty, BundleConfig>({
  loadBundleConfig({bundleGraph, logger}): BundleConfig {
    if (publicIdToAssetSideEffects !== null) {
      return {publicIdToAssetSideEffects};
    }

    publicIdToAssetSideEffects = new Map<string, SideEffectsMap>();
    logger.verbose({
      message: 'Generating publicIdToAssetSideEffects for require optimisation',
    });
    bundleGraph.traverse(node => {
      if (node.type === 'asset') {
        const publicId = bundleGraph.getAssetPublicId(node.value);
        let sideEffectsMap = nullthrows(publicIdToAssetSideEffects);
        sideEffectsMap.set(publicId, {
          sideEffects: node.value.sideEffects,
          filePath: node.value.filePath,
        });
      }
    });
    logger.verbose({message: 'Generation complete'});
    return {publicIdToAssetSideEffects};
  },

  async optimize({bundle, options, contents, map, logger, bundleConfig}) {
    if (options.mode !== 'production') {
      return {contents, map};
    }

    try {
      const ast = await parse(contents.toString());
      const visitor = new RequireInliningVisitor({
        bundle,
        logger,
        publicIdToAssetSideEffects: bundleConfig.publicIdToAssetSideEffects,
      });
      visitor.visitProgram(ast);
      if (visitor.dirty) {
        const newContents = await print(ast, {});
        return {contents: newContents.code, map};
      }
    } catch (err) {
      logger.error({
        origin: 'parcel-optimizer-experimental-inline-requires',
        message: `Unable to optimise requires for ${bundle.name}: ${err.message}`,
        stack: err.stack,
      });
    }
    return {contents, map};
  },
});
