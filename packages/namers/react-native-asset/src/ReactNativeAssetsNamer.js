// @flow strict-local

import {Namer} from '@parcel/plugin';
import path from 'path';
import nullthrows from 'nullthrows';
import {hashString} from '@parcel/hash';

const SCALE_REGEX = /^(.+?)(@([\d.]+)x)?\.\w+$/;

export default (new Namer({
  name({bundle, options}) {
    if (bundle.type === 'png') {
      let asset = nullthrows(bundle.getMainEntry());
      if (asset.pipeline === 'rn-asset') {
        const [, base, suffix] = nullthrows(
          path.basename(asset.filePath).match(SCALE_REGEX),
        );

        return `${base}.${hashString(
          path.posix.relative(
            options.projectRoot,
            path.posix.join(
              path.dirname(asset.filePath),
              `${base}.${bundle.type}`,
            ),
          ),
        )}${suffix ?? ''}.${bundle.type}`;
      }
    }
  },
}): Namer);
