// @flow
import type {
  ReporterEvent,
  BuildProgressEvent,
  LogEvent,
  BundleGraph,
  ParcelOptions
} from '@parcel/types';
import {Color} from 'ink';
import React from 'react';
import {Log, Progress} from './Log';
import prettifyTime from '@parcel/utils/src/prettifyTime';
import BundleReport from './BundleReport';

type UIState = {
  progress: ?BuildProgressEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
};

const LOG_LEVELS = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  success: 3,
  verbose: 4
};

export default class UI extends React.PureComponent<{}, UIState> {
  state = {
    progress: null,
    logs: [],
    bundleGraph: null
  };

  render() {
    return (
      <Color reset>
        <div>
          {this.state.logs.map((log, i) => <Log key={i} log={log} />)}
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

  report(event: ReporterEvent, options: ParcelOptions) {
    this.setState(state => reducer(state, event, options));
  }
}

function reducer(
  state: UIState,
  event: ReporterEvent,
  options: ParcelOptions
): UIState {
  let logLevel = LOG_LEVELS[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildStart':
      if (logLevel < LOG_LEVELS.info) {
        break;
      }

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
      if (logLevel < LOG_LEVELS.info) {
        break;
      }

      return {
        ...state,
        progress: event
      };

    case 'buildSuccess':
      if (logLevel < LOG_LEVELS.success) {
        break;
      }

      var time = prettifyTime(event.buildTime);
      return {
        ...state,
        progress: null,
        bundleGraph: options.mode === 'production' ? event.bundleGraph : null,
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
      if (logLevel < LOG_LEVELS.error) {
        break;
      }

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
      if (logLevel < LOG_LEVELS[event.level]) {
        break;
      }

      // Skip duplicate logs
      var messages = new Set(state.logs.map(l => l.message));
      if (messages.has(event.message)) {
        break;
      }

      return {
        ...state,
        logs: [...state.logs, event]
      };
  }

  return state;
}
