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
  'url'
];

export default new Transformer({
  async transform({ asset, config, logger, options, resolve }) {
    
    let rawCode = await asset.getCode();
    // allowing any recieved jsonld to be in json5 format
    let jsonCode = json5.parse(rawCode);
    
    let parser = new JSONLDParser(asset);    
    
    // this will send the jsonld to the JSONTransformer
    asset.type = 'json';
    // setting it to jsonCode since the parser updates asset paths
    asset.setCode(JSON.stringify(jsonCode));
    return [asset];
  }
});

class JSONLDParser {
  asset;

  constructor(asset) {
    this.asset = asset;    
  }

  parse(jsonld) {
    jsonld = this.extractUrlsFrom(jsonld);
  }

  extractUrlsFrom(data) {
    if(!data) return null;
    
    if (typeof data === 'string') return this.transformString(data);

    if(Array.isArray(data)) return this.iterateThroughArray(data);

    return this.iterateThroughObject(data);
  }

  iterateThroughObject(jsonObject) {
    Object
    .keys(jsonObject)
    .filter(k => SCHEMA_ATTRS.includes(k))
    .forEach((k, i, arr) => {
      let value = jsonObject[k];
      jsonObject[k] = this.extractUrlsFrom(value);
    });

    return jsonObject;
  }

  iterateThroughArray(jsonArray) {
    Object
    .keys(jsonArray)
    .forEach(i => {
      let value = jsonArray[i];
      jsonArray[i] = this.extractUrlsFrom(value);
    });

    return jsonArray;
  }

  transformString(value) {
    let assetPath = this.asset.addURLDependency(value, {});
    return assetPath;
  }
}