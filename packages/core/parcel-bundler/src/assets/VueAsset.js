const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const md5 = require('../utils/md5');
const {minify} = require('terser');
const t = require('@babel/types');

class VueAsset extends Asset {
  constructor(name, options) {
    super(name, options);
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
      sourceRoot: '', // Used for sourcemaps. Override so it doesn't use cwd
      compiler: this.vueTemplateCompiler
    });
  }

  async generate() {
    let descriptor = this.ast;
    let parts = [];

    if (descriptor.script) {
      parts.push({
        type: descriptor.script.lang || 'js',
        value: descriptor.script.content,
        map: descriptor.script.map
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
    let id = md5(this.name).slice(-6);
    let scopeId = hasScoped ? `data-v-${id}` : null;
    let optsVar = '$' + id;

    // Generate JS output.
    let js = this.ast.script ? generated[0].value : '';
    let supplemental = '';

    // TODO: make it possible to process this code with the normal scope hoister
    if (this.options.scopeHoist) {
      optsVar = `$${t.toIdentifier(this.id)}$export$default`;

      if (!js.includes(optsVar)) {
        optsVar = `$${t.toIdentifier(this.id)}$exports`;
        if (!js.includes(optsVar)) {
          supplemental += `
            var ${optsVar} = {};
          `;

          this.cacheData.isCommonJS = true;
        }
      }
    } else {
      supplemental += `
        var ${optsVar} = exports.default || module.exports;
      `;
    }

    supplemental += `
      if (typeof ${optsVar} === 'function') {
        ${optsVar} = ${optsVar}.options;
      }
    `;

    supplemental += this.compileTemplate(generated, scopeId, optsVar);
    supplemental += this.compileCSSModules(generated, optsVar);
    supplemental += this.compileHMR(generated, optsVar);

    if (this.options.minify && !this.options.scopeHoist) {
      let {code, error} = minify(supplemental, {toplevel: true});
      if (error) {
        throw error;
      }

      supplemental = code;
      if (supplemental) {
        supplemental = `\n(function(){${supplemental}})();`;
      }
    }
    js += supplemental;

    if (js) {
      result.push({
        type: 'js',
        value: js,
        map: this.options.sourceMaps && this.ast.script && generated[0].map
      });
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

  compileTemplate(generated, scopeId, optsVar) {
    let html = generated.find(r => r.type === 'html');
    if (html) {
      let isFunctional = this.ast.template.attrs.functional;
      let template = this.vue.compileTemplate({
        source: html.value,
        filename: this.relativeName,
        compiler: this.vueTemplateCompiler,
        isProduction: this.options.production,
        isFunctional,
        compilerOptions: {
          scopeId
        }
      });

      if (Array.isArray(template.errors) && template.errors.length >= 1) {
        throw new Error(template.errors[0]);
      }

      return `
        /* template */
        Object.assign(${optsVar}, (function () {
          ${template.code}
          return {
            render: render,
            staticRenderFns: staticRenderFns,
            _compiled: true,
            _scopeId: ${JSON.stringify(scopeId)},
            functional: ${JSON.stringify(isFunctional)}
          };
        })());
      `;
    }

    return '';
  }

  compileCSSModules(generated, optsVar) {
    let cssRenditions = generated.filter(r => r.type === 'css');
    let cssModulesCode = '';
    this.ast.styles.forEach((style, index) => {
      if (style.module) {
        let cssModules = JSON.stringify(cssRenditions[index].cssModules);
        let name = style.module === true ? '$style' : style.module;
        cssModulesCode += `\nthis[${JSON.stringify(name)}] = ${cssModules};`;
      }
    });

    if (cssModulesCode) {
      cssModulesCode = `function hook(){${cssModulesCode}\n}`;

      let isFunctional =
        this.ast.template && this.ast.template.attrs.functional;
      if (isFunctional) {
        return `
          /* css modules */
          (function () {
            ${cssModulesCode}
            ${optsVar}._injectStyles = hook;
            var originalRender = ${optsVar}.render;
            ${optsVar}.render = function (h, context) {
              hook.call(context);
              return originalRender(h, context);
            };
          })();
        `;
      } else {
        return `
          /* css modules */
          (function () {
            ${cssModulesCode}
            ${optsVar}.beforeCreate = ${optsVar}.beforeCreate ? ${optsVar}.beforeCreate.concat(hook) : [hook];
          })();
        `;
      }
    }

    return '';
  }

  compileStyle(generated, scopeId) {
    return generated
      .filter(r => r.type === 'css')
      .reduce((p, r, i) => {
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

  compileHMR(generated, optsVar) {
    if (!this.options.hmr) {
      return '';
    }

    this.addDependency('vue-hot-reload-api');
    this.addDependency('vue');

    let cssHMR = '';
    if (this.ast.styles.length) {
      cssHMR = `
        var reloadCSS = require('_css_loader');
        module.hot.dispose(reloadCSS);
        module.hot.accept(reloadCSS);
      `;
    }

    let isFunctional = this.ast.template && this.ast.template.attrs.functional;

    return `
    /* hot reload */
    (function () {
      if (module.hot) {
        var api = require('vue-hot-reload-api');
        api.install(require('vue'));
        if (api.compatible) {
          module.hot.accept();
          if (!module.hot.data) {
            api.createRecord('${optsVar}', ${optsVar});
          } else {
            api.${
              isFunctional ? 'rerender' : 'reload'
            }('${optsVar}', ${optsVar});
          }
        }

        ${cssHMR}
      }
    })();`;
  }
}

module.exports = VueAsset;
