import React from 'react';
import {Box} from 'ink';
import {countBreaks} from 'grapheme-breaker';

export function Table({children}) {
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

export function Row({colWidths, children}) {
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

function getAlign(node) {
  return node.props.align || 'left';
}

export function Cell(props) {
  let pad = ' '.repeat(props.length - countBreaks(getText({props})));
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

function getText(node) {
  if (typeof node === 'string') {
    return node;
  }

  let t = '';
  React.Children.forEach(node.props.children, n => {
    t += getText(n);
  });

  return t;
}
