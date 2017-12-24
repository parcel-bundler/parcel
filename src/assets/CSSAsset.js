const Asset = require('../Asset');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const postcssTransform = require('../transforms/postcss');
const CssSyntaxError = require('postcss/lib/css-syntax-error');

const URL_RE = /url\s*\("?(?![a-z]+:)/;
const IMPORT_RE = /@import/;
const PROTOCOL_RE = /^[a-z]+:/;

class CSSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
  }

  mightHaveDependencies() {
    return (
      !/\.css$/.test(this.name) ||
      IMPORT_RE.test(this.contents) ||
      URL_RE.test(this.contents)
    );
  }

  parse(code) {
    let root = postcss.parse(code, {from: this.name, to: this.name});
    return new CSSAst(code, root);
  }

  collectDependencies() {
    this.ast.root.walkAtRules('import', rule => {
      let params = valueParser(rule.params).nodes;
      let [name, ...media] = params;
      let dep;
      if (name.type === 'string') {
        dep = name.value;
      } else if (
        name.type === 'function' &&
        name.value === 'url' &&
        name.nodes.length
      ) {
        dep = name.nodes[0].value;
      }

      if (!dep) {
        throw new Error('Could not find import name for ' + rule);
      }

      if (PROTOCOL_RE.test(dep)) {
        return;
      }

      media = valueParser.stringify(media).trim();
      this.addDependency(dep, {media, loc: rule.source.start});

      rule.remove();
      this.ast.dirty = true;
    });

    this.ast.root.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let dirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length
          ) {
            let url = this.addURLDependency(node.nodes[0].value, {
              loc: decl.source.start
            });
            dirty = node.nodes[0].value !== url;
            node.nodes[0].value = url;
          }
        });

        if (dirty) {
          decl.value = parsed.toString();
          this.ast.dirty = true;
        }
      }
    });
  }

  async transform() {
    await postcssTransform(this);
  }

  getCSSAst() {
    // Converts the ast to a CSS ast if needed, so we can apply postcss transforms.
    if (!(this.ast instanceof CSSAst)) {
      this.ast = CSSAsset.prototype.parse.call(this, this.ast.render());
    }

    return this.ast.root;
  }

  generate() {
    let css = this.ast ? this.ast.render() : this.contents;

    let js = '';
    if (this.options.hmr) {
      this.addDependency('_css_loader');

      js = `
        var reloadCSS = require('_css_loader');
        module.hot.dispose(reloadCSS);
        module.hot.accept(reloadCSS);
      `;
    }

    if (this.cssModules) {
      js +=
        'module.exports = ' + JSON.stringify(this.cssModules, false, 2) + ';';
    }

    return {css, js};
  }

  generateErrorMessage(err) {
    // Wrap the error in a CssSyntaxError if needed so we can generate a code frame
    if (err.loc && !err.showSourceCode) {
      err = new CssSyntaxError(
        err.message,
        err.loc.line,
        err.loc.column,
        this.contents
      );
    }

    err.message = err.reason || err.message;
    err.loc = {
      line: err.line,
      column: err.column
    };

    if (err.showSourceCode) {
      err.codeFrame = err.showSourceCode();
      err.highlightedCodeFrame = err.showSourceCode(true);
    }

    return err;
  }
}

class CSSAst {
  constructor(css, root) {
    this.css = css;
    this.root = root;
    this.dirty = false;
  }

  render() {
    if (this.dirty) {
      this.css = '';
      postcss.stringify(this.root, c => (this.css += c));
    }

    return this.css;
  }
}

module.exports = CSSAsset;
