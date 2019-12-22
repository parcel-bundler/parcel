// @flow
import {Transformer} from '@parcel/plugin';
import {promisify} from '@parcel/utils';
import marked from 'marked';
import hljs from 'highlight.js';
import fm from 'front-matter';
import Mustache from 'mustache';

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>{{title}}</title>
</head>
<body>
  {{{ body }}}
</body>
</html>`;

const markedParse = promisify(marked.parse);

export default new Transformer({
  async transform({asset}) {
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
    let res = Mustache.render(template, attributes);

    asset.setCode(res);

    return [asset];
  },
});
