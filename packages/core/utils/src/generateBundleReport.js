// @flow strict-local

import type {Asset, BundleGraph} from '@parcel/types';
import nullthrows from 'nullthrows';

export type BundleReport = {|
  bundles: Array<{|
    filePath: string,
    size: number,
    time: number,
    largestAssets: Array<{|
      filePath: string,
      size: number,
      time: number
    |}>,
    totalAssets: number
  |}>
|};

export default function generateBundleReport(
  bundleGraph: BundleGraph,
  largestAssetCount: number = 10
): BundleReport {
  let bundles = [];
  bundleGraph.traverseBundles(bundle => {
    bundles.push(bundle);
  });
  bundles.sort((a, b) => b.stats.size - a.stats.size);

  return {
    bundles: bundles.map(bundle => {
      let assets: Array<Asset> = [];
      bundle.traverseAssets(asset => {
        assets.push(asset);
      });
      assets.sort((a, b) => b.stats.size - a.stats.size);

      return {
        filePath: nullthrows(bundle.filePath),
        size: bundle.stats.size,
        time: bundle.stats.time,
        largestAssets: assets.slice(0, largestAssetCount).map(asset => ({
          filePath: asset.filePath,
          size: asset.stats.size,
          time: asset.stats.time
        })),
        totalAssets: assets.length
      };
    })
  };
}
