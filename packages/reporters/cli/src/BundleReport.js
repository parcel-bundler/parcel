// @flow strict-local

import type {BundleGraph, FilePath} from '@parcel/types';

import * as React from 'react';
import filesize from 'filesize';
import {Box, Color} from 'ink';
import {generateBundleReport, prettifyTime} from '@parcel/utils';
import path from 'path';
import * as emoji from './emoji';
import {Table, Row, Cell} from './Table';

const LARGE_BUNDLE_SIZE = 1024 * 1024;

type ReportProps = {|
  bundleGraph: BundleGraph
|};

export default function BundleReport(
  props: ReportProps
): React.Element<typeof Table> {
  let {bundles} = generateBundleReport(props.bundleGraph);

  let rows: Array<React.Element<typeof Row>> = [<Row key="first" />];
  for (let bundle of bundles) {
    rows.push(
      <Row key={`bundle:${bundle.filePath}`}>
        <Cell>
          {formatFilename(bundle.filePath || '', {cyan: true, bold: true})}
        </Cell>
        <Cell align="right">
          <Color bold>
            {prettifySize(bundle.size, bundle.size > LARGE_BUNDLE_SIZE)}
          </Color>
        </Cell>
        <Cell align="right">
          <Color green bold>
            {prettifyTime(bundle.time)}
          </Color>
        </Cell>
      </Row>
    );

    for (let asset of bundle.largestAssets) {
      // Add a row for the asset.
      rows.push(
        <Row key={`bundle:${bundle.filePath}:asset:${asset.filePath}`}>
          <Cell>
            {asset == bundle.largestAssets[bundle.largestAssets.length - 1]
              ? '└── '
              : '├── '}
            {formatFilename(asset.filePath, {})}
          </Cell>
          <Cell align="right">
            <Color dim>{prettifySize(asset.size)}</Color>
          </Cell>
          <Cell align="right">
            <Color green dim>
              {prettifyTime(asset.time)}
            </Color>
          </Cell>
        </Row>
      );
    }

    // Show how many more assets there are
    if (bundle.totalAssets > bundle.largestAssets.length) {
      rows.push(
        <Row key={`bundleAssetCount:${bundle.filePath}`}>
          <Cell>
            └──{' '}
            <Color dim>
              + {bundle.totalAssets - bundle.largestAssets.length} more assets
            </Color>
          </Cell>
        </Row>
      );
    }

    // If this isn't the last bundle, add an empty row before the next one
    if (bundle !== bundles[bundles.length - 1]) {
      rows.push(<Row key={`spacer:${bundle.filePath}`} />);
    }
  }

  return <Table>{rows.map(r => React.cloneElement(r, {key: r.key}))}</Table>;
}

function formatFilename(filename: FilePath, color = {}) {
  let dir = path.relative(process.cwd(), path.dirname(filename));

  return (
    <Box>
      <Color dim>{dir + (dir ? path.sep : '')}</Color>
      <Color {...color}>{path.basename(filename)}</Color>
    </Box>
  );
}

function prettifySize(size: number, isLarge?: boolean) {
  let res = filesize(size);
  if (isLarge) {
    return <Color yellow>{emoji.warning + '  ' + res}</Color>;
  }
  return <Color magenta>{res}</Color>;
}
