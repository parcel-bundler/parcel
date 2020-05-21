// @flow

import type {Asset, FilePath, NamedBundle} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import SourceMap from '@parcel/source-map';
import nullthrows from 'nullthrows';
import path from 'path';
import {loadSourceMapUrl} from './';

export type AssetStats = {|
  filePath: string,
  size: number,
  originalSize: number,
  time: number,
|};

export type BundleStats = {|
  filePath: string,
  size: number,
  time: number,
  assets: Array<AssetStats>,
|};

export type BuildMetrics = {|
  bundles: Array<BundleStats>,
|};

async function getSourcemapSizes(
  filePath: FilePath,
  fs: FileSystem,
  projectRoot: FilePath,
): Promise<?Map<string, number>> {
  let bundleContents = await fs.readFile(filePath, 'utf-8');
  let mapUrlData = await loadSourceMapUrl(fs, filePath, bundleContents);
  if (!mapUrlData) {
    return null;
  }

  let rawMap = mapUrlData.map;
  let sourceMap = new SourceMap();
  sourceMap.addRawMappings(rawMap.mappings, rawMap.sources, rawMap.names);
  let parsedMapData = sourceMap.getMap();

  if (parsedMapData.mappings.length > 2) {
    let sources = parsedMapData.sources.map(s => path.join(projectRoot, s));
    let currLine = 1;
    let currColumn = 0;
    let currMappingIndex = 0;
    let currMapping = parsedMapData.mappings[currMappingIndex];
    let nextMapping = parsedMapData.mappings[currMappingIndex + 1];
    let sourceSizes = new Array(sources.length).fill(0);
    for (let i = 0; i < bundleContents.length; i++) {
      // Update currMapping to be the next mapping with a source
      while (
        !currMapping.source ||
        currMapping.source < 0 ||
        nextMapping.generated.column <= currColumn
      ) {
        currMappingIndex++;
        if (currMappingIndex > parsedMapData.mappings.length - 2) {
          break;
        }
        currMapping = parsedMapData.mappings[currMappingIndex];
        nextMapping = parsedMapData.mappings[currMappingIndex + 1];
      }

      let c = bundleContents[i];
      if (
        currMapping.generated.line === currLine &&
        currMapping.generated.column <= currColumn &&
        (nextMapping.generated.line > currLine ||
          (nextMapping.generated.line === currLine &&
            nextMapping.generated.column > currColumn))
      ) {
        // $FlowFixMe flow got confused
        sourceSizes[currMapping.source] += Buffer.byteLength(c, 'utf8');
      }

      if (c === '\n') {
        currColumn = 0;
        currLine++;
      } else {
        currColumn++;
      }
    }

    let sizeMap = new Map();
    for (let i = 0; i < sourceSizes.length; i++) {
      sizeMap.set(sources[i], sourceSizes[i]);
    }

    return sizeMap;
  }
}

async function createBundleStats(
  bundle: NamedBundle,
  fs: FileSystem,
  projectRoot: FilePath,
) {
  let filePath = bundle.filePath;
  let sourcemapSizes = await getSourcemapSizes(filePath, fs, projectRoot);

  let assets: Array<Asset> = [];
  bundle.traverseAssets(asset => {
    assets.push(asset);
  });

  let index = {};
  let assetsReport: Array<AssetStats> = assets
    .filter(a => {
      if (!index[a.filePath]) {
        index[a.filePath] = true;
        return true;
      } else {
        return false;
      }
    })
    .map(asset => {
      let foundSize = sourcemapSizes && sourcemapSizes.get(asset.filePath);

      return {
        filePath: asset.filePath,
        size: foundSize ? foundSize : asset.stats.size,
        originalSize: asset.stats.size,
        time: asset.stats.time,
      };
    });

  return {
    filePath: nullthrows(bundle.filePath),
    size: bundle.stats.size,
    time: bundle.stats.time,
    assets: assetsReport.sort((a, b) => b.size - a.size),
  };
}

export default async function generateBuildMetrics(
  bundles: Array<NamedBundle>,
  fs: FileSystem,
  projectRoot: FilePath,
): Promise<BuildMetrics> {
  bundles.sort((a, b) => b.stats.size - a.stats.size).filter(b => !!b.filePath);

  return {
    bundles: (
      await Promise.all(bundles.map(b => createBundleStats(b, fs, projectRoot)))
    ).filter(e => !!e),
  };
}
