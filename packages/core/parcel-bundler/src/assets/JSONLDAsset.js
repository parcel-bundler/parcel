const urlJoin = require('../utils/urlJoin');
const isURL = require('../utils/is-url');
const Asset = require('../Asset');
const logger = require('@parcel/logger');

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
  'contentUrl'
];

class JSONLDAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'jsonld';
  }

  parse(content) {
    return JSON.parse(content.trim());
  }

  collectDependencies() {
    if (!this.options.publicURL.startsWith('http')) {
      logger.warn(
        "Please specify a publicURL using --public-url, otherwise schema assets won't be collected"
      );
      return;
    }

    for (let schemaKey in this.ast) {
      if (SCHEMA_ATTRS.includes(schemaKey)) {
        this.collectFromKey(this.ast, schemaKey);
        this.isAstDirty = true;
      }
    }
  }

  // Auxiliary method for collectDependencies() to use for recursion
  collectFromKey(schema, schemaKey) {
    if (!schema.hasOwnProperty(schemaKey)) {
      return;
    }
    // values can be strings or objects
    // if it's not a string, it should have a url
    if (typeof schema[schemaKey] === 'string') {
      let assetPath = this.addURLDependency(schema[schemaKey]);
      if (!isURL(assetPath)) {
        // paths aren't allowed, values must be urls
        assetPath = urlJoin(this.options.publicURL, assetPath);
      }
      schema[schemaKey] = assetPath;
    } else if (Array.isArray(schema[schemaKey])) {
      Object.keys(schema[schemaKey]).forEach(i => {
        this.collectFromKey(schema[schemaKey], i);
      });
    } else {
      this.collectFromKey(schema[schemaKey], 'url');
    }
  }

  generate() {
    if (this.options.production) {
      return JSON.stringify(this.ast);
    } else {
      return JSON.stringify(this.ast, null, 2);
    }
  }
}

module.exports = JSONLDAsset;
