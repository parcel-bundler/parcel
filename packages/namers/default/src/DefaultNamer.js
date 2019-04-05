// @flow
import {Namer} from '@parcel/plugin';
import crypto from 'crypto';
import path from 'path';

const COMMON_NAMES = new Set(['index', 'src', 'lib']);
const DEFAULT_DIST_DIR = 'dist';

export default new Namer({
  name(bundle, opts) {
    // If the bundle has an explicit file path given (e.g. by a target), use that.
    if (bundle.filePath) {
      // TODO: what about multiple assets in the same dep?
      // e.g. input is a Vue file, output is JS + CSS
      // which is defined as a target in package.json?
      return bundle.filePath;
    }

    // TODO: if split bundle, base name on original bundle names?
    let entryAsset = bundle.getEntryAssets()[0];
    let entryFilePath = entryAsset.filePath;
    let name = path.basename(entryFilePath, path.extname(entryFilePath));

    // If this is an entry bundle, exclude the hash and use the original relative path.
    if (bundle.isEntry) {
      name = path
        .join(
          path.relative(
            // $FlowFixMe
            opts.rootDir,
            path.dirname(entryFilePath)
          ),
          `${name}.${bundle.type}`
        )
        .replace(/\.\.(\/|\\)/g, '__$1');
    } else {
      // If this is an index file or common directory name, use the parent
      // directory name instead, which is probably more descriptive.
      while (COMMON_NAMES.has(name)) {
        entryFilePath = path.dirname(entryFilePath);
        name = path.basename(entryFilePath);
      }

      // Get a content hash for this bundle, for long term caching.
      let hash = getHash(bundle);
      name = `${name}.${hash.slice(-8)}.${bundle.type}`;
    }

    let distDir =
      bundle.target && bundle.target.distPath
        ? path.dirname(bundle.target.distPath)
        : DEFAULT_DIST_DIR;
    return path.join(distDir, name);
  }
});

function getHash(bundle) {
  let hash = crypto.createHash('md5');
  bundle.traverseAssets(asset => {
    hash.update(asset.outputHash);
  });

  return hash.digest('hex');
}
