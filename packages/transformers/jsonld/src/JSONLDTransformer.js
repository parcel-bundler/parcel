// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';
import { isURL, urlJoin } from '@parcel/utils';

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
    // allowing any recieved jsonld to be in json5 format
    let rawCode = await asset.getCode();
    let jsonCode = json5.parse(rawCode);

    /* console.log(jsonCode);
    console.log(config);
    console.log(options);
    console.log(JSON.stringify({ asset, config, logger, options, resolve })); */
    
    console.log(jsonCode);
    let parser = new JSONLDParser(asset);
    console.log("parsing....");
    parser.parse(jsonCode);
    console.log("done");
    console.log(jsonCode);
    
    // this will send the jsonld to the JSONTransformer
    asset.type = 'json';
    // setting it to jsonCode since the parser updates asset paths
    asset.setCode(JSON.stringify(jsonCode));
    return [asset];
  },
});

class JSONLDParser {
  asset;
  publicURL;
  constructor(asset){
    this.asset = asset;    
    this.publicURL = ""; // unable to figure out where I can get this from
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
      console.log(`found key: ${k}`);      
      console.log(value);
      // updating the path to the asset
      jsonObject[k] = this.extractUrlsFrom(value);
    });

    return jsonObject;
  }

  iterateThroughArray(jsonArray) {
    Object
    .keys(jsonArray)
    .forEach(i => {
      let value = jsonArray[i];
      console.log(value);
      jsonArray[i] = this.extractUrlsFrom(value);
    });

    return jsonArray;
  }

  transformString(value) {
    let assetPath = this.asset.addURLDependency(value, {});
    console.log(assetPath);

    /* if (!isURL(assetPath)) {
      // paths aren't allowed, values must be urls
      assetPath = urlJoin(this.publicURL, assetPath);
    } */
    
    return assetPath;
  }
}