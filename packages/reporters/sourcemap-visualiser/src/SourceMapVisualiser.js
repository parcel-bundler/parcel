// @flow
import path from 'path';
import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import {relativePath} from '@parcel/utils';

export default (new Reporter({
  async report({event, options, logger}) {
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
              map.sources.map(async s => {
                let sourceContent = '';
                try {
                  sourceContent = await options.inputFS.readFile(
                    path.resolve(options.projectRoot, s),
                    'utf-8',
                  );
                } catch (e) {
                  logger.warn({
                    message: `Error while loading content of ${s}, ${e.message}`,
                  });
                }

                return {
                  name: s,
                  content: sourceContent,
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

      await options.outputFS.writeFile(
        path.join(options.projectRoot, 'sourcemap-info.json'),
        JSON.stringify(bundles),
      );

      logger.log({
        message: `Goto https://sourcemap-visualiser.now.sh/ and upload the generated sourcemap-info.json file to visualise and debug the sourcemaps.`,
      });
    }
  },
}): Reporter);
