// @flow
// https://developer.mozilla.org/en-US/docs/Web/Manifest
import type {SchemaEntity} from '@parcel/utils';

import invariant from 'assert';
import {parse} from '@mischnic/json-sourcemap';
import {getJSONSourceLocation} from '@parcel/diagnostic';
import {Transformer} from '@parcel/plugin';
import {validateSchema} from '@parcel/utils';

const RESOURCES_SCHEMA = {
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
    icons: RESOURCES_SCHEMA,
    screenshots: RESOURCES_SCHEMA,
  },
};

export default (new Transformer({
  async transform({asset}) {
    const source = await asset.getCode();
    const {data, pointers} = parse(source);

    validateSchema.diagnostic(
      MANIFEST_SCHEMA,
      {source, map: {data, pointers}, filePath: asset.filePath},
      '@parcel/transformer-webmanifest',
      'Invalid webmanifest',
    );

    for (const key of ['icons', 'screenshots']) {
      const list = data[key];
      if (list) {
        invariant(Array.isArray(list));
        for (let i = 0; i < list.length; i++) {
          const res = list[i];
          res.src = asset.addURLDependency(res.src, {
            loc: {
              filePath: asset.filePath,
              ...getJSONSourceLocation(pointers[`/${key}/${i}/src`], 'value'),
            },
          });
        }
      }
    }

    asset.type = 'webmanifest';
    asset.setCode(JSON.stringify(data));
    return [asset];
  },
}): Transformer);
