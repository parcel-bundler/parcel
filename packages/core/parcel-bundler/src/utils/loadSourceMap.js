const logger = require('@parcel/logger');
const path = require('path');
const fs = require('@parcel/fs');

const SOURCEMAP_RE = /(?:\/\*|\/\/)\s*[@#]\s*sourceMappingURL\s*=\s*([^\s*]+)(?:\s*\*\/)?/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

async function loadSourceMap(asset) {
  // Get original sourcemap if there is any
  let match = asset.contents.match(SOURCEMAP_RE);
  let sourceMap;
  if (match) {
    asset.contents = asset.contents.replace(SOURCEMAP_RE, '');

    let url = match[1];
    let dataURLMatch = url.match(DATA_URL_RE);

    try {
      let json, filename;
      if (dataURLMatch) {
        filename = asset.name;
        json = Buffer.from(dataURLMatch[1], 'base64').toString();
      } else {
        filename = path.join(path.dirname(asset.name), url);
        json = await fs.readFile(filename, 'utf8');

        // Add as a dep so we watch the source map for changes.
        asset.addDependency(filename, {includedInParent: true});
      }

      sourceMap = JSON.parse(json);

      // Attempt to read missing source contents
      if (!sourceMap.sourcesContent) {
        sourceMap.sourcesContent = [];
      }

      let missingSources = sourceMap.sources.slice(
        sourceMap.sourcesContent.length
      );
      if (missingSources.length) {
        let contents = await Promise.all(
          missingSources.map(async source => {
            try {
              let sourceFile = path.join(
                path.dirname(filename),
                sourceMap.sourceRoot || '',
                source
              );
              let result = await fs.readFile(sourceFile, 'utf8');
              asset.addDependency(sourceFile, {includedInParent: true});
              return result;
            } catch (err) {
              logger.warn(
                `Could not load source file "${source}" in source map of "${
                  asset.relativeName
                }".`
              );
            }
          })
        );

        sourceMap.sourcesContent = sourceMap.sourcesContent.concat(contents);
      }
    } catch (e) {
      logger.warn(
        `Could not load existing sourcemap of "${asset.relativeName}".`
      );
      sourceMap = undefined;
    }
  }
  return sourceMap;
}

module.exports = loadSourceMap;
