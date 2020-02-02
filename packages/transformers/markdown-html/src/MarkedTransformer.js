// @flow
import {Transformer} from '@parcel/plugin';
import {promisify} from '@parcel/utils';
import marked from 'marked';
import hljs from 'highlight.js';
import fm from 'front-matter';

const markedParse = promisify(marked.parse);

export default new Transformer({
  async transform({asset}) {
    asset.type = 'md';

    let code = await asset.getCode();
    let {body, attributes} = fm(code);

    for (let key in attributes) {
      asset.meta[key] = attributes[key];
    }

    asset.setCode(
      await markedParse(body, {
        renderer: new marked.Renderer(),
        highlight: (code: string, lang: string) => {
          return hljs.highlight(lang, code).value;
        },
        pedantic: false,
        gfm: true,
        breaks: false,
        sanitize: false,
        smartLists: true,
        smartypants: false,
        xhtml: false,
      }),
    );

    if (attributes.template) {
      asset.addDependency({
        moduleSpecifier: attributes.template,
      });
    }

    return [asset];
  },
});
