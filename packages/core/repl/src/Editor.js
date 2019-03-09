import {h} from 'preact';
import path from 'path';
import mime from 'mime-types';

import {Controlled as CodeMirror} from 'react-codemirror2';
import 'codemirror/mode/jsx/jsx.js';
import 'codemirror/mode/css/css.js';
import 'codemirror/mode/htmlmixed/htmlmixed.js';
import 'codemirror/mode/vue/vue.js';

import 'codemirror/lib/codemirror.css';

function patchMime(v) {
  if (/(?:application|text)\/javascript/.test(v)) return 'text/jsx';
  else return v;
}

export default function Editor({
  filename,
  editable,
  content,
  onChange = () => {}
}) {
  const options = {
    lineNumbers: true,
    lineWrapping: true,
    indentWithTabs: true,
    indentUnit: 2,
    tabSize: 2,
    mode: patchMime(mime.lookup(path.extname(filename))),
    value: content,
    readOnly: !editable
  };
  return (
    <CodeMirror
      value={content}
      options={options}
      onBeforeChange={(editor, data, value) => {
        if (data.origin !== 'setValue') {
          onChange(value);
        }
      }}
      autoCursor={true}
    />
  );
}
