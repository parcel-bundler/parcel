// @flow strict-local

import type {FilePath, PackagedBundle, PluginOptions} from '@parcel/types';

import invariant from 'assert';
import {Reporter} from '@parcel/plugin';
import {DefaultMap, generateBuildMetrics} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';

type BundleData = {|
  groups: Array<Group>,
|};

type File = {|
  basename: string,
  size: number,
|};
type DirMapValue = File | DirMap;
type DirMap = DefaultMap<FilePath, DirMapValue>;

export default (new Reporter({
  async report({event, options}) {
    if (event.type !== 'buildSuccess') {
      return;
    }

    let bundlesByTarget: DefaultMap<
      string /* target name */,
      Array<PackagedBundle>,
    > = new DefaultMap(() => []);
    for (let bundle of event.bundleGraph.getBundles()) {
      bundlesByTarget.get(bundle.target.name).push(bundle);
    }

    let reportsDir = path.join(options.projectRoot, 'parcel-bundle-reports');
    await options.outputFS.mkdirp(reportsDir);

    await Promise.all(
      [...bundlesByTarget.entries()].map(async ([targetName, bundles]) => {
        return options.outputFS.writeFile(
          path.join(reportsDir, `${targetName}.html`),
          await getBundleAnalyzerReport(targetName, bundles, options),
        );
      }),
    );
  },
}): Reporter);

export async function getBundleAnalyzerReport(
  targetName: string,
  bundles: Array<PackagedBundle>,
  options: PluginOptions,
): Promise<string> {
  let foamtreePath = path.resolve(
    __dirname,
    '../client/vendor/foamtree/carrotsearch.foamtree.js',
  );
  let clientPath = path.resolve(__dirname, '../client/index.js');
  console.time(foamtreePath);
  console.time(clientPath);
  console.time('bundleData');

  let [foamtree, client, data] = await Promise.all([
    options.inputFS.readFile(foamtreePath, 'utf8').then(r => {
      console.timeEnd(foamtreePath);
      return r;
    }),
    options.inputFS.readFile(clientPath, 'utf8').then(r => {
      console.timeEnd(clientPath);
      return r;
    }),
    getBundleData(bundles, options).then(r => {
      console.timeEnd('bundleData');
      return JSON.stringify(r);
    }),
  ]);

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <title>📦Parcel Bundle Analyzer | ${targetName}</title>
        <style>
          body {
            margin: 0;
          }

          .tooltip {
            background-color: rgba(255, 255, 255, 0.7);
            left: 0;
            padding: 20px;
            pointer-events: none;
            position: absolute;
            top: 0;
            transform: translate3d(0, 0, 0);
          }

          .tooltip-content {
            font-family: monospace;
          }

          .tooltip-content dl div {
            display: flex;
          }

          .tooltip-title {
            font-size: 18px;
          }
        </style>
        <script>
          ${foamtree}
        </script>
        <script id="bundle-data" type="application/json">
          ${data}
        </script>
      </head>
      <body>
        <script>
          ${client}
        </script>
      </body>
    </html>
  `;
}

async function getBundleData(
  bundles: Array<PackagedBundle>,
  options: PluginOptions,
): Promise<BundleData> {
  let groups = await Promise.all(
    bundles.map(bundle => getBundleNode(bundle, options)),
  );
  return {
    groups,
  };
}

let createMap: () => DirMap = () => new DefaultMap(() => createMap());

async function getBundleNode(bundle: PackagedBundle, options: PluginOptions) {
  let buildMetrics = await generateBuildMetrics(
    [bundle],
    options.outputFS,
    options.projectRoot,
  );
  let bundleData = buildMetrics.bundles[0];
  let dirMap = createMap();
  for (let asset of bundleData.assets) {
    let relativePath = path.relative(options.projectRoot, asset.filePath);
    let parts = relativePath.split(path.sep);
    let dirs = parts.slice(0, parts.length - 1);
    let basename = path.basename(asset.filePath);

    let map = dirMap;
    for (let dir of dirs) {
      invariant(map instanceof DefaultMap);
      map = map.get(dir);
    }

    invariant(map instanceof DefaultMap);
    map.set(basename, {
      basename,
      size: asset.size,
    });
  }

  return {
    label: path.relative(options.projectRoot, bundle.filePath),
    weight: bundle.stats.size,
    groups: generateGroups(dirMap),
  };
}

type Group = {|
  label: string,
  weight: number,
  groups?: Array<Group>,
|};

function generateGroups(dirMap: DirMap): Array<Group> {
  let groups = [];

  for (let [directoryName, contents] of dirMap) {
    if (contents instanceof DefaultMap) {
      let childrenGroups = generateGroups(contents);
      if (childrenGroups.length === 1) {
        let firstChild = childrenGroups[0];
        groups.push({
          ...firstChild,
          label: path.join(directoryName, firstChild.label),
        });
      } else {
        groups.push({
          label: directoryName,
          weight: childrenGroups.reduce(
            (acc, g) => acc + nullthrows(g.weight),
            0,
          ),
          groups: childrenGroups,
        });
      }
    } else {
      // file
      groups.push({
        label:
          contents.basename === ''
            ? 'Code from unknown source files'
            : contents.basename,
        weight: contents.size,
      });
    }
  }

  return groups;
}
