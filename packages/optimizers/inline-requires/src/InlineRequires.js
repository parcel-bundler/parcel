// @flow strict-local
import {Optimizer} from '@parcel/plugin';
import {parse, print} from '@swc/core';
import {RequireInliningVisitor} from './RequireInliningVisitor';
import type {SideEffectsMap} from './types';
import nullthrows from 'nullthrows';
import SourceMap from '@parcel/source-map';

let publicIdToAssetSideEffects = null;

type BundleConfig = {|
  publicIdToAssetSideEffects: Map<string, SideEffectsMap>,
|};

// $FlowFixMe not sure how to anotate the export here to make it work...
module.exports = new Optimizer<empty, BundleConfig>({
  loadBundleConfig({bundle, bundleGraph, tracer}): BundleConfig {
    if (publicIdToAssetSideEffects !== null) {
      return {publicIdToAssetSideEffects};
    }

    publicIdToAssetSideEffects = new Map<string, SideEffectsMap>();

    if (!bundle.env.shouldOptimize) {
      return {publicIdToAssetSideEffects};
    }

    const measurement = tracer.createMeasurement(
      '@parcel/optimizer-inline-requires',
      'generatePublicIdToAssetSideEffects',
      bundle.name,
    );

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

    measurement && measurement.end();

    return {publicIdToAssetSideEffects};
  },

  async optimize({
    bundle,
    contents,
    map: originalMap,
    tracer,
    logger,
    bundleConfig,
    options,
  }) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map: originalMap};
    }

    try {
      const measurement = tracer.createMeasurement(
        '@parcel/optimizer-inline-requires',
        'parse',
        bundle.name,
      );
      const ast = await parse(contents.toString());
      measurement && measurement.end();

      const visitor = new RequireInliningVisitor({
        bundle,
        logger,
        publicIdToAssetSideEffects: bundleConfig.publicIdToAssetSideEffects,
      });
      visitor.visitProgram(ast);

      if (visitor.dirty) {
        const result = await print(ast, {sourceMaps: !!bundle.env.sourceMap});

        let sourceMap = null;
        let resultMap = result.map;
        let contents: string = nullthrows(result.code);

        if (resultMap != null) {
          sourceMap = new SourceMap(options.projectRoot);
          sourceMap.addVLQMap(JSON.parse(resultMap));
          if (originalMap) {
            sourceMap.extends(originalMap);
          }
        }

        return {contents, map: sourceMap};
      }
    } catch (err) {
      logger.error({
        origin: 'parcel-optimizer-experimental-inline-requires',
        message: `Unable to optimise requires for ${bundle.name}: ${err.message}`,
        stack: err.stack,
      });
    }
    return {contents, map: originalMap};
  },
});
