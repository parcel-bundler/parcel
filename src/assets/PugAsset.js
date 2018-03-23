const Asset = require('../Asset');
const HTMLAsset = require('./HTMLAsset');

const load = require('pug-load');
const lexer = require('pug-lexer');
const parser = require('pug-parser');
const walk = require('pug-walk');
const linker = require('pug-linker');
const generateCode = require('pug-code-gen');
const wrap = require('pug-runtime/wrap');
const filters = require('pug-filters');

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

  parse(code) {
    let ast = load.string(code, {
      lex: lexer,
      parse: parser,
      filename: this.name
    });

    ast = linker(ast);
    ast = filters.handleFilters(ast);

    return ast;
  }

  collectDependencies() {
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

  generate() {
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
