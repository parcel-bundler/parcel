const urlJoin = require('../utils/urlJoin');
const isURL = require('../utils/is-url');
const Asset = require('../Asset');
const logger = require('../Logger');

// A list of all attributes in a schema that may produce a dependency
// Based on https://schema.org/ImageObject
// Section "Instances of ImageObject may appear as values for the following properties"
const SCHEMA_ATTRS = [
  'logo',
  'photo',
  'image',
  'thumbnail',
  'screenshot',
  'primaryImageOfPage'
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
        "Please specify a publicURL using --public-url, otherwise schema asset links won't work"
      );
      return;
    }

    for (let schemaKey in this.ast) {
      // values can be strings or objects
      if (SCHEMA_ATTRS.includes(schemaKey)) {
        this.collectFromKey(this.ast, schemaKey);
        this.isAstDirty = true;
      }
    }
  }

  collectFromKey(schema, schemaKey) {
    // paths aren't allowed, values must be urls
    if (!schema.hasOwnProperty(schemaKey)) {
      return;
    }
    if (typeof schema[schemaKey] !== 'string') {
      this.collectFromKey(schema[schemaKey], 'url');
    } else {
      let assetPath = this.addURLDependency(schema[schemaKey]);
      if (!isURL(assetPath)) {
        assetPath = urlJoin(this.options.publicURL, assetPath);
      }
      schema[schemaKey] = assetPath;
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
