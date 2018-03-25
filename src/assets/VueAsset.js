const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class VueAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  async generate() {
    const vue = await localRequire('@vue/component-compiler-utils', this.name);

    let descriptor = vue.parse({
      source: this.contents,
      needMap: false //this.options.sourceMaps
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
        value: descriptor.template.content
      });
    }

    if (descriptor.styles) {
      for (let style of descriptor.styles) {
        parts.push({
          type: style.lang || 'css',
          value: style.content
        });
      }
    }

    return parts;
  }

  async postProcess(generated) {
    const vue = await localRequire('@vue/component-compiler-utils', this.name);
    const vueTemplateCompiler = await localRequire(
      'vue-template-compiler',
      this.name
    );

    let result = [];
    let html = generated.find(r => r.type === 'html');
    let template = vue.compileTemplate({
      source: html.value,
      filename: this.name,
      compiler: vueTemplateCompiler
    });

    // Combine JS output. This is because the CSS asset generates some JS for HMR.
    // TODO: deal with export for CSS modules too
    let js = generated
      .filter(r => r.type === 'js')
      .reduce((p, r) => (p += r.value), '');
    js += `\nObject.assign(exports.default || module.exports, (function () {
      ${template.code}
      return {render, staticRenderFns, _compiled: true};
    })())\n`;

    result.push({
      type: 'js',
      value: js
    });

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
    result.push({
      type: 'css',
      value: css
    });

    return result;
  }
}

module.exports = VueAsset;
