const path = require('path');

const Asset = require('../Asset');
const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

class PugAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'html';
  }

  async process() {
    await super.process();

    const htmlAsset = new HTMLAsset(this.name, this.package, this.options);

    htmlAsset.contents = this.generated.html;
    htmlAsset.dependencies = new Map([...this.dependencies]);

    await htmlAsset.process();

    Object.assign(this, htmlAsset);

    return this.generated;
  }

  async generate() {
    const pug = await localRequire('pug', this.name);
    const config =
      (await this.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};

    const compiled = pug.compile(this.contents, {
      compileDebug: false,
      filename: this.name,
      basedir: path.dirname(this.name),
      pretty: !this.options.minify,
      templateName: path.basename(this.basename, path.extname(this.basename)),
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases
    });

    if (compiled.dependencies) {
      compiled.dependencies.forEach(item => {
        this.addDependency(item, {
          includedInParent: true
        });
      });
    }

    return {html: compiled()};
  }
}

module.exports = PugAsset;
