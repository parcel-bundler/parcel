// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';
import {validateSchema} from '@parcel/utils';
import {encodeJSONKeyComponent} from '@parcel/diagnostic';
import WebExtSchema from './schema';

const BASE_KEYS = ['manifest_version', 'name', 'version'];

export default (new Transformer({
  async parse({asset}) {
    const manifest = json5.parse(await asset.getCode());
    if (BASE_KEYS.some(key => !manifest.hasOwnProperty(key))) {
      // This is probably just another file that happens to be named manifest.json
      return null;
    }
    validateSchema.diagnostic(
      WebExtSchema,
      manifest,
      asset.filePath,
      await asset.getCode(),
      '@parcel/transformer-webext',
      `/${encodeJSONKeyComponent('@parcel/transformer-webext')}`,
      'Invalid Web Extension manifest'
    );
    return {
      type: 'json5',
      version: '2.1.0',
      program: manifest
    }
  },
  async transform({asset}) {
    const manifest = await asset.getAST();
    
    asset.meta.hasDependencies = false;
    return [asset];
  },
}): Transformer);
