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
    /// allowing any recieved jsonld to be json5
    let rawCode = await asset.getCode();
    let jsonCode = json5.parse(rawCode);
    console.log(jsonCode);

    console.log(config);
    console.log(options);
    console.log(JSON.stringify({ asset, config, logger, options, resolve }));

    let parser = new JSONLDParser(asset);
    let collectedUrls = parser.parse(jsonCode);
    console.log(collectedUrls);
    
    let stringified = JSON.stringify(jsonCode);
    let output = JSON.stringify(stringified);

    asset.type = 'js';
    asset.setCode(`JSON.parse(${output})`);
    return [asset];
  },
});

class JSONLDParser {
  asset;
  publicURL;
  urls;
  constructor(asset){
    this.asset = asset;
    this.publicURL = "";
    this.urls = [];
  }

  parse(jsonld) {
    this.extractUrlsFrom(jsonld);
    return this.urls;
  }

  extractUrlsFrom(data) {
    if(!data) return;
    
    if (typeof data === 'string') {
      this.transformString(data);
      return;
    }

    if(Array.isArray(data)) {
      this.iterateThroughArray(data);
      return;
    }

    this.iterateThroughObject(data);
  }

  iterateThroughObject(jsonObject) {
    Object
    .keys(jsonObject)
    .filter(k => SCHEMA_ATTRS.includes(k))
    .forEach((k, i, arr) => {
      let value = jsonObject[k];
      console.log(`found key: ${k}`);      
      console.log(value);
      this.extractUrlsFrom(value);
    });
  }

  iterateThroughArray(jsonArray) {
    Object
    .keys(jsonArray)
    .forEach(i => {
      let value = jsonArray[i];
      console.log(value);
      this.extractUrlsFrom(value);
    });
  }

  transformString(value) {
    let assetPath = this.asset.addURLDependency(value, {});
    //let url = `${this.publicURL}/${value}`;
    //this.urls.push(url);
    /* let assetPath = this.asset.addURLDependency(currentValue);
    if (!isURL(assetPath)) {
      // paths aren't allowed, values must be urls
      assetPath = urlJoin(this.publicURL, assetPath);
    }
    schema[schemaKey] = assetPath; */
  }
}