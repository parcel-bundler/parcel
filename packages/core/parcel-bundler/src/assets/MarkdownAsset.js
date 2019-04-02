const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');
const path = require('path');
const fs = require('@parcel/fs');

class MarkdownAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'html';
    this.hmrPageReload = true;
  }
  async generate() {
    const fm = await localRequire('front-matter', this.name);
    const marked = await localRequire('marked', this.name);

    let markedOptions = {};

    const markedConfig = await this.getConfig(['marked.config.js']);
    if (markedConfig) {
      markedOptions = {
        markedOptions,
        ...markedConfig
      };
    }

    const doc = fm(this.contents);

    this.frontMatterAttributes = doc.attributes;

    const perFileConfig = doc.attributes['markedConfig'];
    if (perFileConfig && typeof perFileConfig === 'object') {
      markedOptions = {
        markedOptions,
        ...perFileConfig
      };
    }

    // .trim() is important here – test asserts rely on trimmed strings for easy comparison
    let contents = marked(doc.body, markedOptions).trim();

    contents = await this.applyMustacheTemplate(contents, doc.attributes);

    return [
      {
        type: 'html',
        value: contents
      }
    ];
  }

  async postProcess(generated) {
    const compiledMarkdown = generated.find(t => t.type === 'html').value;

    const jsModule = {
      contents: compiledMarkdown,
      attributes: this.frontMatterAttributes
    };

    generated.push({
      type: 'js',
      value: `module.exports=${JSON.stringify(jsModule)}`
    });
    return generated;
  }

  async applyMustacheTemplate(contents, attributes) {
    const templatePath = attributes['mustacheTemplate'];
    if (!templatePath) {
      return contents;
    }

    if (typeof templatePath !== 'string') {
      throw new Error(`${this.name}: mustacheTemplate should be a string`);
    }

    const templatePathNormalized = path.join(
      path.dirname(this.name),
      templatePath
    );

    const template = (await fs.readFile(templatePathNormalized)).toString();

    const mustache = await localRequire('mustache', this.name);
    return mustache.render(template, {
      contents,
      ...attributes
    });
  }
}
module.exports = MarkdownAsset;
