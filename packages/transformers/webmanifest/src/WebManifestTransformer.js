// @flow
// https://developer.mozilla.org/en-US/docs/Web/Manifest
import type {MutableAsset} from '@parcel/types';
import type {SchemaEntity} from '@parcel/utils';

import {Transformer} from '@parcel/plugin';
import invariant from 'assert';
import {parse} from 'json-source-map';
import {getJSONSourceLocation} from '@parcel/diagnostic';
import {validateSchema} from '@parcel/utils';

type Manifest = {
  serviceworker?: string,
  icons: Array<{src: string, ...}>,
  screenshots: Array<{src: string, ...}>,
  ...
};

const ICONS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      src: {
        type: 'string',
        __validate: s => {
          if (s.length === 0) {
            return 'Must not be empty';
          }
        },
      },
    },
    required: ['src'],
  },
};
const MANIFEST_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    icons: ICONS_SCHEMA,
    screenshots: ICONS_SCHEMA,
  },
};

function collectDependencies(
  asset: MutableAsset,
  source: string,
  data: Manifest,
  pointers: any,
) {
  validateSchema.diagnostic(
    MANIFEST_SCHEMA,
    {source, map: {data, pointers}, filePath: asset.filePath},
    '@parcel/transformer-webmanifest',
    'Invalid webmanifest',
  );

  for (let key of ['icons', 'screenshots']) {
    let list = data[key];
    if (list) {
      invariant(Array.isArray(list));
      for (let i = 0; i < list.length; i++) {
        let icon = list[i];
        icon.src = asset.addURLDependency(icon.src, {
          loc: {
            filePath: asset.filePath,
            ...getJSONSourceLocation(pointers[`/${key}/${i}/src`], 'value'),
          },
        });
      }
    }
  }
}
export default new Transformer({
  async transform({asset}) {
    let contents = await asset.getCode();
    const {data, pointers} = parse(contents);
    collectDependencies(asset, contents, data, pointers);

    asset.type = 'webmanifest';
    asset.setCode(JSON.stringify(data));
    return [asset];
  },
});
