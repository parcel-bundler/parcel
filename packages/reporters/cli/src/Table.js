// @flow strict-local

import * as React from 'react';
import nullthrows from 'nullthrows';
import {Box} from 'ink';
import {countBreaks} from 'grapheme-breaker';

type TableProps = {|
  children: React.Element<typeof Row> | Iterable<React.Element<typeof Row>>
|};
export function Table({children}: TableProps) {
  // Measure column widths
  let colWidths = [];
  React.Children.forEach(children, row => {
    let i = 0;
    React.Children.forEach(row.props.children, cell => {
      colWidths[i] = Math.max(colWidths[i] || 0, countBreaks(getText(cell)));
      i++;
    });
  });

  return React.Children.map(children, row => {
    return React.cloneElement(row, {colWidths});
  });
}

type RowProps = {|
  colWidths?: Array<number>,
  children?: React.Element<typeof Cell> | Iterable<React.Element<typeof Cell>>
|};

export function Row(props: RowProps) {
  let children = props.children;
  // This is injected above in cloneElement
  let colWidths = nullthrows(props.colWidths);

  let childArray = React.Children.toArray(children);
  let items = childArray.map((cell, i) => {
    // Add padding between columns unless the alignment is the opposite to the
    // next column and pad to the column width.
    let padding =
      !childArray[i + 1] ||
      getAlign(childArray[i + 1]) === getAlign(childArray[i])
        ? 4
        : 0;
    return React.cloneElement(cell, {length: colWidths[i] + padding});
  });

  return <Box>{items.length > 0 ? items : ' '}</Box>;
}

function getAlign(node: React.Element<typeof Cell>): 'left' | 'right' {
  return node.props.align || 'left';
}

type CellProps = {|
  align?: 'left' | 'right',
  children: React.Node,
  length?: number
|};
export function Cell(props: CellProps) {
  // This is injected above in cloneElement
  let length = nullthrows(props.length);

  let pad = ' '.repeat(length - countBreaks(getText({props})));
  if (props.align === 'right') {
    return (
      <React.Fragment>
        <span>{pad}</span>
        <Box>{props.children}</Box>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <Box>{props.children}</Box>
      <span>{pad}</span>
    </React.Fragment>
  );
}

function getText(node: string | number | {props: CellProps, ...}): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return node.toString();
  }

  if (!node.props) {
    return '';
  }

  let t = '';
  React.Children.forEach(node.props.children, n => {
    t += getText(n);
  });

  return t;
}
