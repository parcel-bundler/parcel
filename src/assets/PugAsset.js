const Asset = require('../Asset');
const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

class PugAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'html';
  }

  async parse(code) {
    const load = await localRequire('pug-load', this.name);
    const lexer = await localRequire('pug-lexer', this.name);
    const parser = await localRequire('pug-parser', this.name);
    const linker = await localRequire('pug-linker', this.name);
    const filters = await localRequire('pug-filters', this.name);

    this.config =
      (await this.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};

    let ast = load.string(code, {
      lex: lexer,
      parse: parser,
      filename: this.name
    });

    ast = linker(ast);
    ast = filters.handleFilters(ast, this.config.filters || {});

    return ast;
  }

  async collectDependencies() {
    const walk = await localRequire('pug-walk', this.name);

    walk(this.ast, node => {
      this.recursiveCollect(node);
      return node;
    });
  }

  async process() {
    await super.process();

    const htmlAsset = new HTMLAsset(this.name, this.package, this.options);
    htmlAsset.contents = this.generated.html;
    await htmlAsset.process();

    Object.assign(this, htmlAsset);

    return this.generated;
  }

  async generate() {
    const generateCode = await localRequire('pug-code-gen', this.name);
    const wrap = await localRequire('pug-runtime/wrap', this.name);

    const result = generateCode(this.ast, {
      compileDebug: false,
      pretty: !this.options.minify
    });

    return {html: wrap(result)()};
  }

  recursiveCollect(node) {
    if (node.type === 'Block') {
      node.nodes.forEach(n => this.recursiveCollect(n));
    } else {
      if (
        node.filename &&
        node.filename !== this.name &&
        !this.dependencies.has(node.filename)
      ) {
        this.addDependency(node.filename, {
          name: node.filename,
          includedInParent: true
        });
      }
    }
  }
}

module.exports = PugAsset;
