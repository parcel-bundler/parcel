const path = require('path');
const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class PugAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'html';
    this.hmrPageReload = true;
  }

  async generate() {
    const pug = await localRequire('pug', this.name);
    const config =
      (await this.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};
    var pretty=!this.options.minify;
    if(pretty && 'pretty' in config){
      pretty = config.pretty;
    }
    const compiled = pug.compile(this.contents, {
      compileDebug: false,
      filename: this.name,
      basedir: path.dirname(this.name),
      pretty: pretty,
      templateName: path.basename(this.basename, path.extname(this.basename)),
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases
    });

    if (compiled.dependencies) {
      for (let item of compiled.dependencies) {
        this.addDependency(item, {
          includedInParent: true
        });
      }
    }

    return compiled(config.locals);
  }
}

module.exports = PugAsset;
