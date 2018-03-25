const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class VueAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  async generate() {
    // Is being used in component-compiler-utils, errors if not installed...
    await localRequire('vue-template-compiler', this.name);
    const vue = await localRequire('@vue/component-compiler-utils', this.name);

    let descriptor = vue.parse({
      source: this.contents,
      needMap: this.options.sourceMaps == true,
      filename: this.relativeName // Used for sourcemaps
    });

    let parts = [];
    if (descriptor.script) {
      parts.push({
        type: descriptor.script.lang || 'js',
        value: descriptor.script.content
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
          value: style.content.trim()
        });
      }
    }

    return parts;
  }

  async postProcess(generated) {
    // Is being used in component-compiler-utils, errors if not installed...
    const vueTemplateCompiler = await localRequire(
      'vue-template-compiler',
      this.name
    );
    const vue = await localRequire('@vue/component-compiler-utils', this.name);

    let result = [];

    // Combine JS output. This is because the CSS asset generates some JS for HMR.
    // TODO: deal with export for CSS modules too
    let js = generated
      .filter(r => r.type === 'js')
      .reduce((p, r) => (p += r.value), '');

    let html = generated.find(r => r.type === 'html');
    if (html) {
      let template = vue.compileTemplate({
        source: html.value,
        filename: this.relativeName,
        compiler: vueTemplateCompiler,
        isProduction: this.options.production === true
      });

      js += `\nObject.assign(exports.default || module.exports, (function () {
        ${template.code}
        return {render, staticRenderFns, _compiled: true};
      })())\n`;
    }

    if (js) {
      result.push({
        type: 'js',
        value: js
      });
    }

    // TODO: combine source maps for the above changes
    let map = generated.find(r => r.type === 'map');
    if (map) {
      result.push(map);
    }

    // Combine CSS outputs
    // TODO: process with vue.compileStyle for scoped CSS transform
    let css = generated
      .filter(r => r.type === 'css')
      .reduce((p, r) => (p += r.value), '');
    if (css) {
      result.push({
        type: 'css',
        value: css
      });
    }

    return result;
  }
}

module.exports = VueAsset;
