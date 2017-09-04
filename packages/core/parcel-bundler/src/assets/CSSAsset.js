const Asset = require('../Asset');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const path = require('path');
const md5 = require('../utils/md5');

const URL_RE = /url\s*\(\"?(?![a-z]+:)/;
const IMPORT_RE = /@import/;

class CSSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
    this.astIsDirty = false;
  }

  mightHaveDependencies() {
    return IMPORT_RE.test(this.contents) || URL_RE.test(this.contents);
  }

  parse(code) {
    return postcss.parse(code, {from: this.name, to: this.name});
  }

  collectDependencies() {
    this.ast.walkAtRules('import', rule => {
      let params = valueParser(rule.params).nodes;
      let [name, ...media] = params;
      let dep;
      if (name.type === 'string') {
        dep = name.value;
      } else if (name.type === 'function' && name.value === 'url' && name.nodes.length) {
        dep = name.nodes[0].value;
      }

      if (!dep) {
        throw new Error('Could not find import name for ' + rule);
      }

      if (/^[a-z]+:/.test(dep)) {
        return;
      }

      media = valueParser.stringify(media).trim();
      this.addDependency(dep, {media});

      rule.remove();
      this.astIsDirty = true;
    });

    this.ast.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let dirty = false;

        parsed.walk(node => {
          if (node.type === 'function' && node.value === 'url' && node.nodes.length) {
            let filename = node.nodes[0].value;
            if (!filename || /^[a-z]+:/.test(filename)) {
              return;
            }

            this.addDependency(filename);

            let resolved = path.resolve(path.dirname(this.name), filename);
            node.nodes[0].value = md5(resolved) + path.extname(filename);
            this.astIsDirty = dirty = true;
          }
        });

        if (dirty) {
          decl.value = parsed.toString();
        }
      }
    });
  }

  generate() {
    let css = this.contents;
    if (this.astIsDirty) {
      css = '';
      postcss.stringify(this.ast, c => css += c);
    }

    let js = '';
    if (this.modulesJSON) {
      js = 'module.exports = ' + JSON.stringify(this.modulesJSON, false, 2) + ';';
    }

    return {css, js};
  }
}

module.exports = CSSAsset;
