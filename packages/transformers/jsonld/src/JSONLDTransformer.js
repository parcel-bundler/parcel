// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';

// A list of all attributes in a schema that may produce a dependency
// Based on https://schema.org/ImageObject
// Section "Instances of ImageObject may appear as values for the following properties"
const SCHEMA_ATTRS = [
  'logo',
  'photo',
  'image',
  'thumbnail',
  'screenshot',
  'primaryImageOfPage',
  'embedUrl',
  'thumbnailUrl',
  'video',
  'contentUrl',
];

export default new Transformer({
  async transform({ asset, options, resolve }) {
    /// allowing any recieved jsonld to be json5
    let rawCode = await asset.getCode();
    let jsonCode = json5.parse(rawCode);

    console.log(JSON.stringify({ asset, options, resolve }));
    console.log(rawCode);

    Object
      .keys(jsonCode)
      .filter(k => SCHEMA_ATTRS.includes(k))
      .map(k => {
        console.log(`found key: ${k}`);
        console.log(jsonCode[k]);
      });
    
    let output = JSON.stringify(JSON.stringify(jsonCode));
    console.log(output);

    asset.type = 'jsonld';
    asset.setCode(output);
    return [asset];
  },
});