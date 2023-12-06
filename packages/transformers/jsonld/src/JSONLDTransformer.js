// @flow

import {Transformer} from '@parcel/plugin';
import {parseJSON5} from '@parcel/utils';

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
  'url',
];

export default (new Transformer({
  async transform({asset}) {
    let rawCode = await asset.getCode();
    let jsonCode = parseJSON5(asset.filePath, rawCode);

    jsonCode = extractUrlsFrom(jsonCode, asset);

    asset.type = 'jsonld';
    asset.setCode(JSON.stringify(jsonCode));
    return [asset];
  },
}): Transformer);

function extractUrlsFrom(data, asset) {
  if (!data) return null;

  if (typeof data === 'string') {
    let assetPath = asset.addURLDependency(data, {});
    return assetPath;
  }

  if (Array.isArray(data)) return iterateThroughArray(data, asset);

  return iterateThroughObject(data, asset);
}

function iterateThroughObject(jsonObject, asset) {
  Object.keys(jsonObject)
    .filter(k => SCHEMA_ATTRS.includes(k))
    .forEach(k => {
      let value = jsonObject[k];
      jsonObject[k] = extractUrlsFrom(value, asset);
    });

  return jsonObject;
}

function iterateThroughArray(jsonArray, asset) {
  Object.keys(jsonArray).forEach(i => {
    let value = jsonArray[i];
    jsonArray[i] = extractUrlsFrom(value, asset);
  });

  return jsonArray;
}
