// @flow strict-local

import type {
  BundleGraph,
  LogEvent,
  ParcelOptions,
  ProgressLogEvent
} from '@parcel/types';

import {Color} from 'ink';
import React from 'react';
import {Log, Progress} from './Log';
import BundleReport from './BundleReport';

type Props = {|
  bundleGraph: ?BundleGraph,
  logs: Array<LogEvent>,
  options: ParcelOptions,
  progress: ?ProgressLogEvent
|};

export default function UI({logs, progress, bundleGraph, options}: Props) {
  return (
    <Color reset>
      <div>
        {logs.map((log, i) => (
          <Log key={i} event={log} />
        ))}
        {progress ? <Progress event={progress} /> : null}
        {options.mode === 'production' && bundleGraph ? (
          <BundleReport bundleGraph={bundleGraph} />
        ) : null}
      </div>
    </Color>
  );
}
