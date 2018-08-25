const urlJoin = require('../utils/urlJoin');
const isURL = require('../utils/is-url');
const Asset = require('../Asset');

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
    for (let schemaKey in this.ast) {
      // only check for single values, not nested data
      // todo: check for nested data
      if (
        SCHEMA_ATTRS.includes(schemaKey) &&
        typeof this.ast[schemaKey] === 'string'
      ) {
        // paths aren't allowed, values must be urls
        let assetPath = this.addURLDependency(this.ast[schemaKey]);
        if (!isURL(assetPath)) {
          assetPath = urlJoin(this.options.publicURL, assetPath);
        }
        this.ast[schemaKey] = assetPath;
        this.isAstDirty = true;

        if (this.options.publicURL === '/') {
          console.warn(
            "Please specify publicURL using --public-url, otherwise schema asset links won't work"
          );
        }
      }
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
