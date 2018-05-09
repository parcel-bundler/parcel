const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const postcssTransform = require('../../transforms/postcss');
const CssSyntaxError = require('postcss/lib/css-syntax-error');

const URL_RE = /url\s*\("?(?![a-z]+:)/;
const IMPORT_RE = /@import/;
const PROTOCOL_RE = /^[a-z]+:/;

const CSSAsset = {
  type: 'css',

  mightHaveDependencies(state) {
    return (
      !/\.css$/.test(state.name) ||
      IMPORT_RE.test(state.contents) ||
      URL_RE.test(state.contents)
    );
  },

  parse(code, state) {
    let root = postcss.parse(code, {from: state.name, to: state.name});
    return new CSSAst(code, root);
  },

  collectDependencies(ast, state) {
    ast.root.walkAtRules('import', rule => {
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
      state.addDependency(dep, {media, loc: rule.source.start});

      rule.remove();
      ast.dirty = true;
    });

    ast.root.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let dirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length
          ) {
            let url = state.addURLDependency(node.nodes[0].value, {
              loc: decl.source.start
            });
            dirty = node.nodes[0].value !== url;
            node.nodes[0].value = url;
          }
        });

        if (dirty) {
          decl.value = parsed.toString();
          ast.dirty = true;
        }
      }
    });
  },

  transform(ast, state) {
    return postcssTransform(ast, state, getCSSAst);
  },

  generate(ast, state) {
    let css = ast ? (ast.render ? ast.render() : ast.css) : state.contents;

    let js = '';
    if (state.options.hmr) {
      state.addDependency('_css_loader');

      js = `
        var reloadCSS = require('_css_loader');
        module.hot.dispose(reloadCSS);
        module.hot.accept(reloadCSS);
      `;
    }

    if (state.cssModules) {
      js +=
        'module.exports = ' + JSON.stringify(state.cssModules, false, 2) + ';';
    }

    return [
      {
        type: 'css',
        value: css,
        cssModules: state.cssModules
      },
      {
        type: 'js',
        value: js,
        final: true
      }
    ];
  },

  generateErrorMessage(err, state) {
    // Wrap the error in a CssSyntaxError if needed so we can generate a code frame
    if (err.loc && !err.showSourceCode) {
      err = new CssSyntaxError(
        err.message,
        err.loc.line,
        err.loc.column,
        state.contents
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
};

function getCSSAst(ast, state) {
  // Converts the ast to a CSS ast if needed, so we can apply postcss transforms.
  if (!(ast instanceof CSSAst)) {
    ast = CSSAsset.parse(ast.render(), state);
  }

  return ast.root;
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

module.exports = {
  Asset: {
    css: CSSAsset,
    pcss: CSSAsset
  }
};
