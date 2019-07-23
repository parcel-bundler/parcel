const path = require('path');
const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

class PugAsset extends HTMLAsset {
  constructor(name, options) {
    super(name, options);
    this.pugDependencies = [];
  }

  async parse(code) {
    const pug = await localRequire('pug', this.name);
    const config =
      (await this.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};

    const compiled = pug.compile(code, {
      compileDebug: false,
      filename: this.name,
      basedir: path.dirname(this.name),
      pretty: config.pretty || false,
      templateName: path.basename(this.basename, path.extname(this.basename)),
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases
    });

    if (compiled.dependencies) {
      this.pugDependencies = compiled.dependencies;
    }

    // Process the HTML output of the Pug file as if it was an HTML file
    return super.parse(compiled(config.locals));
  }

  collectDependencies() {
    for (const item of this.pugDependencies) {
      this.addDependency(item, {
        includedInParent: true
      });
    }

    super.collectDependencies();
  }
}

module.exports = PugAsset;
