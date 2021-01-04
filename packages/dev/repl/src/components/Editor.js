// @flow
// @jsx h
// eslint-disable-next-line no-unused-vars
import {h} from 'preact';
import {useMemo} from 'preact/hooks';
import {memo} from 'preact/compat';
import path from 'path';

import {CodemirrorEditor} from '@mischnic/codemirror-preact';

import {
  keymap,
  highlightSpecialChars,
  drawSelection,
  // highlightActiveLine,
} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {history, historyKeymap} from '@codemirror/history';
import {foldGutter, foldKeymap} from '@codemirror/fold';
import {indentOnInput} from '@codemirror/language';
import {lineNumbers} from '@codemirror/gutter';
import {defaultKeymap, indentMore, indentLess} from '@codemirror/commands';
import {bracketMatching} from '@codemirror/matchbrackets';
import {closeBrackets, closeBracketsKeymap} from '@codemirror/closebrackets';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {autocompletion, completionKeymap} from '@codemirror/autocomplete';
import {commentKeymap} from '@codemirror/comment';
import {rectangularSelection} from '@codemirror/rectangular-selection';
// import {defaultHighlightStyle} from '@codemirror/highlight';
import {lintKeymap} from '@codemirror/lint';
import {oneDark} from '@codemirror/theme-one-dark';

import {html} from '@codemirror/lang-html';
import {javascript} from '@codemirror/lang-javascript';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';

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
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        // defaultHighlightStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        // highlightActiveLine(),
        highlightSelectionMatches(),
        oneDark,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...commentKeymap,
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
        extension.includes('js') || extension.includes('ts')
          ? javascript()
          : extension === 'html'
          ? html()
          : extension === 'css'
          ? css()
          : extension === 'json' || filename === '.parcelrc'
          ? json()
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

export default Editor;
