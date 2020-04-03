// @flow
/* global globalThis:readonly */

import path from 'path';
import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import {relativePath} from '@parcel/utils';

export default (new Reporter({
  async report({event, options, logger}) {
    // $FlowFixMe
    if (process.browser && !globalThis.PARCEL_SOURCEMAP_VISUALIZER) return;

    if (event.type === 'buildSuccess') {
      let bundles = [];
      for (let bundle of event.bundleGraph.getBundles()) {
        let p = bundle.filePath;
        if (p) {
          let mapFilePath = p + '.map';
          let hasMap = await options.outputFS.exists(mapFilePath);
          if (hasMap) {
            let map = JSON.parse(
              await options.outputFS.readFile(mapFilePath, 'utf-8'),
            );

            let mappedSources = await Promise.all(
              map.sources.map(async (sourceName, index) => {
                let sourceContent = map.sourcesContent?.[index];
                if (sourceContent != null) {
                  try {
                    sourceContent = await options.inputFS.readFile(
                      path.resolve(options.projectRoot, sourceName),
                      'utf-8',
                    );
                  } catch (e) {
                    logger.warn({
                      message: `Error while loading content of ${sourceName}, ${e.message}`,
                    });
                  }
                }

                return {
                  name: sourceName,
                  content: sourceContent ?? '',
                };
              }),
            );

            let fileName = relativePath(options.projectRoot, p);
            bundles.push({
              name: fileName,
              mappings: map.mappings,
              names: map.names,
              sources: mappedSources,
              content: await options.outputFS.readFile(
                nullthrows(bundle.filePath),
                'utf-8',
              ),
            });
          }
        }
      }

      // $FlowFixMe
      if (process.browser) {
        // $FlowFixMe
        globalThis.PARCEL_SOURCEMAP_VISUALIZER(bundles);
      } else {
        await options.outputFS.writeFile(
          path.join(options.projectRoot, 'sourcemap-info.json'),
          JSON.stringify(bundles),
        );

        logger.log({
          message: `Goto https://sourcemap-visualiser.now.sh/ and upload the generated sourcemap-info.json file to visualise and debug the sourcemaps.`,
        });
      }
    }
  },
}): Reporter);
