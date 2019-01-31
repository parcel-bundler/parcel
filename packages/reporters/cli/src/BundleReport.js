// @flow
import React from 'react';
import {BundleGraph} from '@parcel/types';
import filesize from 'filesize';
import {Box} from 'ink';
import prettyTime from '@parcel/logger/src/prettyTime';

type ReportProps = {
  bundleGraph: BundleGraph
};

export default function BundleReport(props: ReportProps) {
  let bundles = [];
  props.bundleGraph.traverseBundles(bundle => bundles.push(bundle));

  // TODO: use real output size, not asset graph size
  bundles.sort((a, b) => b.outputSize - a.outputSize);

  return (
    <div>
      {bundles.map(bundle => (
        <Box>
          {bundle.filePath} {filesize(bundle.outputSize)}
        </Box>
      ))}
    </div>
  );
}
