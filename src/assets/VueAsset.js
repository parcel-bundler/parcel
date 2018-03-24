const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class VueAsset extends JSAsset {
  async parse(code) {
    const vueTemplateCompiler = await localRequire(
      'vue-template-compiler',
      this.name
    );
    const vue = await localRequire('@vue/component-compiler-utils', this.name);

    const descriptor = vue.parse({
      source: code,
      needMap: this.sourceMap === true // true
    });

    let js = descriptor.script.content.trim();

    if (descriptor.template) {
      let template = vue.compileTemplate({
        source: descriptor.template.content,
        filename: this.name,
        compiler: vueTemplateCompiler
      });
      js = template.code + '\n' + js;
    }

    if (descriptor.styles) {
      /*let css = */ descriptor.styles
        .map(style => style.content.trim())
        .join('');
      // TODO: add this css as a css asset
      // this.addDependency(css);
    }

    this.contents = js;
    return await super.parse(this.contents);
  }
}

module.exports = VueAsset;
