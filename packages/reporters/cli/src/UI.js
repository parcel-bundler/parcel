// @flow
import type {
  ReporterEvent,
  LogEvent,
  BundleGraph,
  ParcelOptions
} from '@parcel/types';
import {Color} from 'ink';
import React from 'react';
import {Log, Progress} from './Log';
import prettifyTime from '@parcel/utils/src/prettifyTime';
import BundleReport from './BundleReport';
import path from 'path';

type UIState = {
  progress: ?LogEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
};

const LOG_LEVELS = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  progress: 3,
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
          {this.state.logs.map((log, i) => <Log key={i} event={log} />)}
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
        bundleGraph: null
      };

    case 'buildProgress':
      if (logLevel < LOG_LEVELS.progress) {
        break;
      }

      var message = getProgressMessage(event);
      var progress = state.progress;
      if (message) {
        progress = {
          type: 'log',
          level: 'progress',
          message
        };
      }

      return {
        ...state,
        progress
      };

    case 'buildSuccess':
      if (logLevel < LOG_LEVELS.info) {
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

      if (event.level === 'progress') {
        return {
          ...state,
          progress: event
        };
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

function getProgressMessage(event) {
  switch (event.phase) {
    case 'transforming':
      return `Building ${path.basename(event.request.filePath)}...`;

    case 'bundling':
      return 'Bundling...';

    case 'packaging':
      return `Packaging ${path.basename(event.bundle.filePath || '')}...`;

    case 'optimizing':
      return `Optimizing ${path.basename(event.bundle.filePath || '')}...`;
  }

  return '';
}
