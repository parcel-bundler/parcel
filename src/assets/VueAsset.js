const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const md5 = require('../utils/md5');

class VueAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  async parse(code) {
    // Is being used in component-compiler-utils, errors if not installed...
    this.vueTemplateCompiler = await localRequire(
      'vue-template-compiler',
      this.name
    );
    this.vue = await localRequire('@vue/component-compiler-utils', this.name);

    return this.vue.parse({
      source: code,
      needMap: this.options.sourceMaps,
      filename: this.relativeName, // Used for sourcemaps
      sourceRoot: '' // Used for sourcemaps. Override so it doesn't use cwd
    });
  }

  async generate() {
    let descriptor = this.ast;
    let parts = [];

    if (descriptor.script) {
      parts.push({
        type: descriptor.script.lang || 'js',
        value: descriptor.script.content,
        sourceMap: descriptor.script.map
      });
    }

    if (descriptor.template) {
      parts.push({
        type: descriptor.template.lang || 'html',
        value: descriptor.template.content.trim()
      });
    }

    if (descriptor.styles) {
      for (let style of descriptor.styles) {
        parts.push({
          type: style.lang || 'css',
          value: style.content.trim(),
          modules: !!style.module
        });
      }
    }

    return parts;
  }

  async postProcess(generated) {
    let result = [];

    let hasScoped = this.ast.styles.some(s => s.scoped);
    let scopeId = hasScoped ? `data-v-${md5(this.name).slice(-6)}` : null;

    // Combine JS output. This is because the CSS asset generates some JS for HMR.
    // TODO: deal with export for CSS modules too
    let js = this.ast.script ? generated[0].value : '';
    js += this.compileTemplate(generated, scopeId);
    js += this.compileCSSModules(generated);

    if (js) {
      result.push({
        type: 'js',
        value: js
      });
    }

    // TODO: combine in case of multiple js parts?
    // Unfortunately compileTemplate currently doesn't generate sourcemaps
    let map = generated.find(r => r.type === 'map');
    if (map) {
      result.push(map);
    }

    let css = this.compileStyle(generated, scopeId);
    if (css) {
      result.push({
        type: 'css',
        value: css
      });
    }

    return result;
  }

  compileTemplate(generated, scopeId) {
    let html = generated.find(r => r.type === 'html');
    if (html) {
      let template = this.vue.compileTemplate({
        source: html.value,
        filename: this.relativeName,
        compiler: this.vueTemplateCompiler,
        isProduction: this.options.production,
        compilerOptions: {
          scopeId
        }
      });

      if (Array.isArray(template.errors) && template.errors.length >= 1) {
        throw new Error(template.errors[0]);
      }

      return `
        Object.assign(exports.default || module.exports, (function () {
          ${template.code}
          return {render, staticRenderFns, _compiled: true, _scopeId: ${JSON.stringify(
            scopeId
          )}};
        })());
      `;
    }

    return '';
  }

  compileCSSModules(generated) {
    let cssRenditions = generated.filter(r => r.type === 'css');
    let cssModulesCode = '';
    this.ast.styles.forEach((style, index) => {
      if (style.module) {
        let cssModules = cssRenditions[index].cssModules;
        let name = style.module === true ? '$style' : style.module;
        cssModulesCode += `\nthis[${JSON.stringify(name)}] = ${JSON.stringify(
          cssModules
        )};`;
      }
    });

    if (cssModulesCode) {
      return `
        (function () {
          function beforeCreate(){${cssModulesCode}\n}
          var opts = exports.default || module.exports;
          opts.beforeCreate = opts.beforeCreate ? opts.beforeCreate.concat(beforeCreate) : [beforeCreate];
        })()
      `;
    }

    return '';
  }

  compileStyle(generated, scopeId) {
    return generated.filter(r => r.type === 'css').reduce((p, r, i) => {
      let css = r.value;
      let scoped = this.ast.styles[i].scoped;

      // Process scoped styles if needed.
      if (scoped) {
        let {code, errors} = this.vue.compileStyle({
          source: css,
          filename: this.relativeName,
          id: scopeId,
          scoped
        });

        if (errors.length) {
          throw errors[0];
        }

        css = code;
      }

      return p + css;
    }, '');
  }
}

module.exports = VueAsset;
