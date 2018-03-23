const Asset = require('../Asset');
const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

// A list of all attributes that may produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes
const ATTRS = {
  src: [
    'script',
    'img',
    'audio',
    'video',
    'source',
    'track',
    'iframe',
    'embed'
  ],
  href: ['link', 'a', 'use'],
  srcset: ['img', 'source'],
  poster: ['video'],
  'xlink:href': ['use'],
  content: ['meta']
};

// A regex to detect if a variable is a 'pure' string (no evaluation needed)
const PURE_STRING_REGEX = /(^"([^"]+)"$)|(^'([^']+)'$)/g;

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

    let ast = load.string(code, {
      lex: lexer,
      parse: parser,
      filename: this.name
    });

    ast = linker(ast);
    ast = filters.handleFilters(ast);

    return ast;
  }

  async collectDependencies() {
    const walk = await localRequire('pug-walk', this.name);

    walk(this.ast, node => {
      this.recursiveCollect(node);

      if (node.type === 'Tag') {
        if (node.attrs) {
          for (const attr of node.attrs) {
            const elements = ATTRS[attr.name];
            if (elements && elements.indexOf(node.name) > -1) {
              if (PURE_STRING_REGEX.test(attr.val)) {
                this.addURLDependency(
                  attr.val.substring(1, attr.val.length - 1)
                );
              }
            }
          }
        }
      }

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

  shouldInvalidate() {
    return false;
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
