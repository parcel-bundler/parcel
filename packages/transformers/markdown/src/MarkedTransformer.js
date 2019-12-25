// @flow
import {Transformer} from '@parcel/plugin';
import {promisify} from '@parcel/utils';
import marked from 'marked';
import hljs from 'highlight.js';
import fm from 'front-matter';
import Mustache from 'mustache';

const DEFAULT_TEMPLATE = '{{{ body }}}';

const markedParse = promisify(marked.parse);

export default new Transformer({
  async transform({asset, resolve, options}) {
    asset.type = 'html';

    let code = await asset.getCode();
    let {body, attributes} = fm(code);

    attributes.body = await markedParse(body, {
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
    });

    let template = DEFAULT_TEMPLATE;
    if (attributes.template) {
      let templateLocation = await resolve(asset.filePath, attributes.template);
      template = await options.inputFS.readFile(templateLocation, 'utf-8');
      asset.addIncludedFile({
        filePath: templateLocation,
      });
    }

    let res = Mustache.render(template, attributes);

    asset.setCode(res);

    return [asset];
  },
});
