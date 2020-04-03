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
} from '@codemirror/next/view';
import {EditorState} from '@codemirror/next/state';
import {history, historyKeymap} from '@codemirror/next/history';
import {foldGutter, foldKeymap} from '@codemirror/next/fold';
import {indentOnInput} from '@codemirror/next/language';
import {lineNumbers} from '@codemirror/next/gutter';
import {defaultKeymap, indentMore, indentLess} from '@codemirror/next/commands';
import {bracketMatching} from '@codemirror/next/matchbrackets';
import {
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/next/closebrackets';
import {searchKeymap} from '@codemirror/next/search';
import {autocompletion, completionKeymap} from '@codemirror/next/autocomplete';
import {commentKeymap} from '@codemirror/next/comment';
import {rectangularSelection} from '@codemirror/next/rectangular-selection';
import {gotoLineKeymap} from '@codemirror/next/goto-line';
import {
  highlightActiveLine,
  highlightSelectionMatches,
} from '@codemirror/next/highlight-selection';
import {defaultHighlightStyle} from '@codemirror/next/highlight';
import {lintKeymap} from '@codemirror/next/lint';

import {html} from '@codemirror/next/lang-html';
import {javascript} from '@codemirror/next/lang-javascript';
import {css} from '@codemirror/next/lang-css';
import {json} from '@codemirror/next/lang-json';

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
        defaultHighlightStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        // highlightActiveLine(),
        highlightSelectionMatches(),
        keymap([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...commentKeymap,
          ...gotoLineKeymap,
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
