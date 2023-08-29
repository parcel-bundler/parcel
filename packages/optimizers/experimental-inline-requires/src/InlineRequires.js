import {Optimizer} from '@parcel/plugin';
import {parse, print} from '@swc/core';
import {RequireInliningVisitor} from './RequireInliningVisitor';

let publicIdToAssetSideEffects = null;

module.exports = new Optimizer({
  loadBundleConfig({bundleGraph, logger}) {
    if (publicIdToAssetSideEffects !== null) {
      return {publicIdToAssetSideEffects};
    }

    publicIdToAssetSideEffects = new Map();
    logger.verbose({
      message: 'Generating publicIdToAssetSideEffects for require optimisation',
    });
    bundleGraph.traverse(node => {
      if (node.type === 'asset') {
        const publicId = bundleGraph.getAssetPublicId(node.value);
        publicIdToAssetSideEffects.set(publicId, {
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
      const ast = await parse(contents.toString('utf8'));
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
