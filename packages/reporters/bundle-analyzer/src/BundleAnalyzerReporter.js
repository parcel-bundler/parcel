// @flow strict-local

import type {FilePath, NamedBundle, PluginOptions} from '@parcel/types';

import invariant from 'assert';
import {Reporter} from '@parcel/plugin';
import {DefaultMap, generateBuildMetrics} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';

export default (new Reporter({
  async report({event, options}) {
    if (
      event.type !== 'buildSuccess' ||
      process.env.PARCEL_BUNDLE_ANALYZER == null ||
      // $FlowFixMe
      process.env.PARCEL_BUNDLE_ANALYZER == false
    ) {
      return;
    }

    let bundlesByTarget: DefaultMap<
      string /* target name */,
      Array<NamedBundle>,
    > = new DefaultMap(() => []);
    for (let bundle of event.bundleGraph.getBundles()) {
      if (!bundle.isInline) {
        bundlesByTarget.get(bundle.target.name).push(bundle);
      }
    }

    let reportsDir = path.join(options.projectRoot, 'parcel-bundle-reports');
    await options.outputFS.mkdirp(reportsDir);

    await Promise.all(
      [...bundlesByTarget.entries()].map(async ([targetName, bundles]) => {
        return options.outputFS.writeFile(
          path.join(reportsDir, `${targetName}.html`),
          `
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
                ${await options.inputFS.readFile(
                  path.resolve(
                    __dirname,
                    '../client/vendor/foamtree/carrotsearch.foamtree.js',
                  ),
                  'utf8',
                )}
              </script>
              <script id="bundle-data" type="application/json">
                ${JSON.stringify(await getBundleData(bundles, options))}
              </script>
            </head>
            <body>
              <script>
                ${await options.inputFS.readFile(
                  path.resolve(__dirname, '../client/index.js'),
                  'utf8',
                )}
              </script>
            </body>
          </html>
        `,
        );
      }),
    );
  },
}): Reporter);

type BundleData = {|
  groups: Array<Group>,
|};

async function getBundleData(
  bundles: Array<NamedBundle>,
  options: PluginOptions,
): Promise<BundleData> {
  let groups = await Promise.all(
    bundles.map(bundle => getBundleNode(bundle, options)),
  );
  return {
    groups,
  };
}

type File = {|
  basename: string,
  size: number,
|};
type DirMapValue = File | DirMap;
type DirMap = DefaultMap<FilePath, DirMapValue>;
let createMap: () => DirMap = () => new DefaultMap(() => createMap());

async function getBundleNode(bundle: NamedBundle, options: PluginOptions) {
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
    let basename = parts[parts.length - 1];

    let map = dirMap;
    for (let dir of dirs) {
      invariant(map instanceof DefaultMap);
      map = map.get(dir);
    }

    invariant(map instanceof DefaultMap);
    map.set(basename, {
      basename: path.basename(asset.filePath),
      size: asset.size,
    });
  }

  return {
    label: nullthrows(bundle.name),
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
        label: contents.basename,
        weight: contents.size,
      });
    }
  }

  return groups;
}
