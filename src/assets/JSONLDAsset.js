const Asset = require('../Asset');

// A list of all attributes in a schema that may produce a dependency
// Based on https://schema.org/Place
const SCHEMA_ATTRS = ['logo', 'photo', 'image', 'thumbnail', 'screenshot'];

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
        this.ast[schemaKey] = this.addURLDependency(this.ast[schemaKey]);
        this.isAstDirty = true;
      }
    }
  }

  generate() {
    return JSON.stringify(this.ast);
  }
}

module.exports = JSONLDAsset;
