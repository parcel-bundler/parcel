/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* @flow */
import {useRef} from 'preact/hooks';
import {theme} from '../styles';

const _collapsibleStyle = {
  cursor: 'pointer',
  border: 'none',
  display: 'block',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'Consolas, Menlo, monospace',
  fontSize: '1em',
  padding: '0px',
  lineHeight: '1.5',
};

const collapsibleCollapsedStyle = {
  ..._collapsibleStyle,
  color: theme.color,
  background: theme.background,
  marginBottom: '1.5em',
};

const collapsibleExpandedStyle = {
  ..._collapsibleStyle,
  color: theme.color,
  background: theme.background,
  marginBottom: '0.6em',
};

type CollapsiblePropsType = {|
  children: React$Element<any>[],
|};

function Collapsible(props: CollapsiblePropsType): React$Element<'details'> {
  const ref = useRef(null);
  const collapsed = ref.current?.open;

  const count = props.children.length;
  return (
    <details ref={ref}>
      <summary
        style={collapsed ? collapsibleCollapsedStyle : collapsibleExpandedStyle}
      >
        {(collapsed ? '▶' : '▼') +
          ` ${count} stack frames were ` +
          (collapsed ? 'collapsed.' : 'expanded.')}
      </summary>
      <div>
        {props.children}
        <button
          onClick={() => ref.current?.removeAttribute('open')}
          style={collapsibleExpandedStyle}
        >
          {`▲ ${count} stack frames were expanded.`}
        </button>
      </div>
    </details>
  );
}

export default Collapsible;
