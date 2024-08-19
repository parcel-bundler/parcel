// @flow strict-local
import {Optimizer} from '@atlaspack/plugin';
import {parse, print} from '@swc/core';
import {RequireInliningVisitor} from './RequireInliningVisitor';
import nullthrows from 'nullthrows';
import SourceMap from '@parcel/source-map';

let assetPublicIdsWithSideEffects = null;

type BundleConfig = {|
  assetPublicIdsWithSideEffects: Set<string>,
|};

// $FlowFixMe not sure how to anotate the export here to make it work...
module.exports = new Optimizer<empty, BundleConfig>({
  loadBundleConfig({bundle, bundleGraph, tracer}): BundleConfig {
    if (assetPublicIdsWithSideEffects !== null) {
      return {assetPublicIdsWithSideEffects};
    }

    assetPublicIdsWithSideEffects = new Set<string>();

    if (!bundle.env.shouldOptimize) {
      return {assetPublicIdsWithSideEffects};
    }

    const measurement = tracer.createMeasurement(
      '@atlaspack/optimizer-inline-requires',
      'generatePublicIdToAssetSideEffects',
      bundle.name,
    );

    bundleGraph.traverse(node => {
      if (node.type === 'asset' && node.value.sideEffects) {
        const publicId = bundleGraph.getAssetPublicId(node.value);
        let sideEffectsMap = nullthrows(assetPublicIdsWithSideEffects);
        sideEffectsMap.add(publicId);
      }
    });

    measurement && measurement.end();

    return {assetPublicIdsWithSideEffects};
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
      let measurement = tracer.createMeasurement(
        '@atlaspack/optimizer-inline-requires',
        'parse',
        bundle.name,
      );
      const ast = await parse(contents.toString());
      measurement && measurement.end();

      const visitor = new RequireInliningVisitor({
        bundle,
        logger,
        assetPublicIdsWithSideEffects:
          bundleConfig.assetPublicIdsWithSideEffects,
      });

      measurement = tracer.createMeasurement(
        '@atlaspack/optimizer-inline-requires',
        'visit',
        bundle.name,
      );
      visitor.visitProgram(ast);
      measurement && measurement.end();

      if (visitor.dirty) {
        const measurement = tracer.createMeasurement(
          '@atlaspack/optimizer-inline-requires',
          'print',
          bundle.name,
        );
        const result = await print(ast, {sourceMaps: !!bundle.env.sourceMap});
        measurement && measurement.end();

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
      logger.warn({
        origin: 'atlaspack-optimizer-experimental-inline-requires',
        message: `Unable to optimise requires for ${bundle.name}: ${err.message}`,
        stack: err.stack,
      });
    }
    return {contents, map: originalMap};
  },
});
