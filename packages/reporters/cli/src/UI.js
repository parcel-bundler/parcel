// @flow
import {
  ReporterEvent,
  BuildProgressEvent,
  LogEvent,
  BundleGraph
} from '@parcel/types';
import {Box, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import {Log, Progress} from './Log';
import prettifyTime from '@parcel/utils/src/prettifyTime';
import BundleReport from './BundleReport';

type UIState = {
  progress: ?BuildProgressEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
};

export default class UI extends React.Component<{}, UIState> {
  state = {
    progress: null,
    logs: [],
    bundleGraph: null
  };

  render() {
    return (
      <Color reset>
        <div>
          {this.state.logs.map(log => <Log log={log} />)}
          {this.state.progress ? (
            <Progress event={this.state.progress} />
          ) : null}
          {this.state.bundleGraph ? (
            <BundleReport bundleGraph={this.state.bundleGraph} />
          ) : null}
        </div>
      </Color>
    );
  }

  report(event: ReporterEvent) {
    this.setState(state => reducer(state, event));
  }
}

function reducer(state: UIState, event: ReporterEvent): UIState {
  switch (event.type) {
    case 'buildStart':
      return {
        ...state,
        logs: [],
        bundleGraph: null,
        progress: {
          type: 'buildProgress',
          message: 'Building...'
        }
      };

    case 'buildProgress':
      return {
        ...state,
        progress: event
      };

    case 'buildSuccess':
      var time = prettifyTime(event.buildTime);
      return {
        ...state,
        progress: null,
        bundleGraph: event.bundleGraph,
        logs: [
          ...state.logs,
          {
            type: 'log',
            level: 'success',
            message: `Built in ${time}.`
          }
        ]
      };

    case 'buildFailure':
      return {
        ...state,
        progress: null,
        logs: [
          ...state.logs,
          {
            type: 'log',
            level: 'error',
            message: event.error
          }
        ]
      };

    case 'log':
      return {
        ...state,
        logs: [...state.logs, event]
      };
  }

  return state;
}
