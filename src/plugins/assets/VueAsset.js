const md5 = require('../../utils/md5');
const {minify} = require('uglify-es');

const VueAsset = {
  type: 'js',

  async parse(code, state) {
    // Is being used in component-compiler-utils, errors if not installed...
    state.vueTemplateCompiler = await state.require('vue-template-compiler');
    state.vue = await state.require('@vue/component-compiler-utils');

    return state.vue.parse({
      source: code,
      needMap: state.options.sourceMaps,
      filename: state.relativeName, // Used for sourcemaps
      sourceRoot: '' // Used for sourcemaps. Override so it doesn't use cwd
    });
  },

  async generate(descriptor) {
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
  },

  async postProcess(generated, state) {
    let result = [];

    let hasScoped = state.ast.styles.some(s => s.scoped);
    let id = md5(state.name).slice(-6);
    let scopeId = hasScoped ? `data-v-${id}` : null;
    let optsVar = '$' + id;

    // Generate JS output.
    let js = state.ast.script ? generated[0].value : '';
    let supplemental = `
      var ${optsVar} = exports.default || module.exports;
      if (typeof ${optsVar} === 'function') {
        ${optsVar} = ${optsVar}.options;
      }
    `;

    supplemental += compileTemplate(state, generated, scopeId, optsVar);
    supplemental += compileCSSModules(state, generated, optsVar);
    supplemental += compileHMR(state, generated, optsVar);

    if (state.options.minify && supplemental) {
      let {code, error} = minify(supplemental, {toplevel: true});
      if (error) {
        throw error;
      }

      supplemental = code;
    }

    js += supplemental;

    if (js) {
      result.push({
        type: 'js',
        value: js
      });
    }

    let map = generated.find(r => r.type === 'map');
    if (map) {
      result.push(map);
    }

    let css = compileStyle(state, generated, scopeId);
    if (css) {
      result.push({
        type: 'css',
        value: css
      });
    }

    return result;
  }
};

function compileTemplate(asset, generated, scopeId, optsVar) {
  let html = generated.find(r => r.type === 'html');
  if (html) {
    let isFunctional = asset.ast.template.attrs.functional;
    let template = asset.vue.compileTemplate({
      source: html.value,
      filename: asset.relativeName,
      compiler: asset.vueTemplateCompiler,
      isProduction: asset.options.production,
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

function compileCSSModules(asset, generated, optsVar) {
  let cssRenditions = generated.filter(r => r.type === 'css');
  let cssModulesCode = '';
  asset.ast.styles.forEach((style, index) => {
    if (style.module) {
      let cssModules = JSON.stringify(cssRenditions[index].cssModules);
      let name = style.module === true ? '$style' : style.module;
      cssModulesCode += `\nthis[${JSON.stringify(name)}] = ${cssModules};`;
    }
  });

  if (cssModulesCode) {
    cssModulesCode = `function hook(){${cssModulesCode}\n}`;

    let isFunctional =
      asset.ast.template && asset.ast.template.attrs.functional;
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

function compileStyle(asset, generated, scopeId) {
  return generated.filter(r => r.type === 'css').reduce((p, r, i) => {
    let css = r.value;
    let scoped = asset.ast.styles[i].scoped;

    // Process scoped styles if needed.
    if (scoped) {
      let {code, errors} = asset.vue.compileStyle({
        source: css,
        filename: asset.relativeName,
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

function compileHMR(asset, generated, optsVar) {
  if (!asset.options.hmr) {
    return '';
  }

  asset.addDependency('vue-hot-reload-api');
  asset.addDependency('vue');

  let cssHMR = '';
  if (asset.ast.styles.length) {
    cssHMR = `
      var reloadCSS = require('_css_loader');
      module.hot.dispose(reloadCSS);
      module.hot.accept(reloadCSS);
    `;
  }

  let isFunctional = asset.ast.template && asset.ast.template.attrs.functional;

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
          api.${isFunctional ? 'rerender' : 'reload'}('${optsVar}', ${optsVar});
        }
      }

      ${cssHMR}
    }
  })();`;
}

module.exports = {
  Asset: {
    vue: VueAsset
  }
};
