// @flow strict-local

import type {Asset, Bundle, FilePath} from '@parcel/types';

import * as React from 'react';
import {BundleGraph} from '@parcel/types';
import filesize from 'filesize';
import {Box, Color} from 'ink';
import prettifyTime from '@parcel/utils/src/prettifyTime';
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
  let bundles: Array<Bundle> = [];
  props.bundleGraph.traverseBundles(bundle => bundles.push(bundle));
  bundles.sort((a, b) => b.stats.size - a.stats.size);

  let rows: Array<React.Element<typeof Row>> = [<Row key="first" />];
  for (let bundle of bundles) {
    rows.push(
      <Row key={`bundle:${bundle.id}`}>
        <Cell>
          {formatFilename(bundle.filePath || '', {cyan: true, bold: true})}
        </Cell>
        <Cell align="right">
          <Color bold>
            {prettifySize(
              bundle.stats.size,
              bundle.stats.size > LARGE_BUNDLE_SIZE
            )}
          </Color>
        </Cell>
        <Cell align="right">
          <Color green bold>
            {prettifyTime(bundle.stats.time)}
          </Color>
        </Cell>
      </Row>
    );

    let assets: Array<Asset> = [];
    bundle.assetGraph.traverseAssets(asset => {
      assets.push(asset);
    });
    assets.sort((a, b) => b.stats.size - a.stats.size);

    let largestAssets = assets.slice(0, 10);

    for (let asset of largestAssets) {
      // Add a row for the asset.
      rows.push(
        <Row key={`bundle:${bundle.id}:asset:${asset.id}`}>
          <Cell>
            {asset == assets[assets.length - 1] ? '└── ' : '├── '}
            {formatFilename(asset.filePath, {})}
          </Cell>
          <Cell align="right">
            <Color dim>{prettifySize(asset.stats.size)}</Color>
          </Cell>
          <Cell align="right">
            <Color green dim>
              {prettifyTime(asset.stats.time)}
            </Color>
          </Cell>
        </Row>
      );
    }

    // Show how many more assets there are
    if (assets.length > largestAssets.length) {
      rows.push(
        <Row key={`bundleAssetCount:${bundle.id}`}>
          <Cell>
            └──{' '}
            <Color dim>
              + {assets.length - largestAssets.length} more assets
            </Color>
          </Cell>
        </Row>
      );
    }

    // If this isn't the last bundle, add an empty row before the next one
    if (bundle !== bundles[bundles.length - 1]) {
      rows.push(<Row key={`spacer:${bundle.id}`} />);
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
