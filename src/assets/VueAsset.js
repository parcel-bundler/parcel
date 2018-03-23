const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class VueAsset extends JSAsset {
  async parse(code) {
    const vueCompiler = await localRequire(
      'parcel-vue-component-compiler',
      this.name
    );

    let scopeId = vueCompiler.generateScopeId(
      this.name,
      code,
      this.options.production
    );
    let options = {
      style: null,
      template: null,
      assemble: null
    };

    let descriptor = vueCompiler.parse(code, this.name, {needMap: true});
    let render = descriptor.template
      ? vueCompiler.compileTemplate(
          {
            code: descriptor.template.content,
            descriptor: descriptor.template
          },
          this.name,
          Object.assign({scopeId}, options.template)
        )
      : null;
    let styles = descriptor.styles
      .map(it => {
        return vueCompiler.compileStyle(
          {
            code: it.content,
            descriptor: it
          },
          this.name,
          Object.assign({scopeId}, options.style)
        );
      })
      .map((style, i) => ({
        descriptor: descriptor.styles[i],
        code: style.code,
        map: style.map,
        modules: style.modules
      }));

    this.contents = vueCompiler.assemble(
      {
        styles,
        render: {
          code: render && render.code,
          descriptor: descriptor.template
        },
        script: {
          code: descriptor.script && descriptor.script.content,
          descriptor: descriptor.script
        },
        customBlocks: []
      },
      this.name,
      {scopeId},
      options.assemble
    );
    return await super.parse(this.contents);
  }
}

module.exports = VueAsset;
