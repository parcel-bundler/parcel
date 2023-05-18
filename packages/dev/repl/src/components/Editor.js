// @flow
import {useCallback, useMemo, memo} from 'react';
import path from 'path';

import {CodemirrorEditor} from '../codemirror';

import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  defaultKeymap,
  indentMore,
  indentLess,
  history,
  historyKeymap,
} from '@codemirror/commands';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {lintKeymap} from '@codemirror/lint';
// import {oneDark} from '@codemirror/theme-one-dark';

import {html} from '@codemirror/lang-html';
import {javascript} from '@codemirror/lang-javascript';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';

const theme = EditorView.theme({
  '.cm-content': {
    fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
    fontSize: '14px',
  },
  '.cm-gutters': {
    fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
    fontSize: '14px',
  },
});

const CONFIG_FILE = /^\.\w*rc$/;
const Editor: any = memo(function Editor({
  filename,
  readOnly,
  content,
  onChange,
  diagnostics,
}) {
  const extension = path.extname(filename).slice(1);

  const extensions = useMemo(
    () =>
      [
        !readOnly && lineNumbers(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        theme,
        // oneDark,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          {
            key: 'Tab',
            preventDefault: true,
            run: indentMore,
          },
          {
            key: 'Shift-Tab',
            preventDefault: true,
            run: indentLess,
          },
        ]),
        extension === 'json' || CONFIG_FILE.test(path.basename(filename))
          ? json()
          : extension.startsWith('js') || extension.startsWith('ts')
          ? javascript({
              jsx: extension.endsWith('x'),
              typescript: extension.includes('ts'),
            })
          : extension === 'html'
          ? html()
          : extension === 'css'
          ? css()
          : null,
      ].filter(Boolean),
    [extension],
  );

  return (
    <CodemirrorEditor
      value={content}
      onChange={onChange}
      extensions={extensions}
      readOnly={readOnly}
      diagnostics={diagnostics}
    />
  );
});

function EditorWrapper({
  dispatch,
  name,
  value,
  readOnly,
  diagnostics,
}: any): any {
  let onChange = useCallback(
    value => dispatch({type: 'view.setValue', name, value}),
    [dispatch, name],
  );

  return (
    <Editor
      filename={name}
      content={value}
      onChange={onChange}
      readOnly={readOnly}
      diagnostics={diagnostics}
    />
  );
}

export {EditorWrapper as Editor};
