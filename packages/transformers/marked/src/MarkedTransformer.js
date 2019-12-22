// @flow

import {Transformer} from '@parcel/plugin';
import {promisify} from '@parcel/utils';
import marked from 'marked';
import hljs from 'highlight.js';

let markedParse = promisify(marked.parse);

export default new Transformer({
  async transform({asset}) {
    asset.type = 'html';

    let markedOptions = {
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
    };

    let code = await asset.getCode();
    let res = await markedParse(code, markedOptions);

    asset.setCode(res);

    return [asset];
  },
});
