// @flow strict-local

import type {
  BundleGraph,
  LogEvent,
  ParcelOptions,
  ProgressLogEvent,
  ReporterEvent
} from '@parcel/types';
import {Color} from 'ink';
import React from 'react';
import {Log, Progress} from './Log';
import {prettifyTime} from '@parcel/utils';
import logLevels from './logLevels';
import {getProgressMessage} from './utils';
import BundleReport from './BundleReport';

type Props = {|
  options: ParcelOptions
|};

type State = {|
  progress: ?ProgressLogEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
|};

export default class UI extends React.PureComponent<Props, State> {
  state = {
    progress: null,
    logs: [],
    bundleGraph: null
  };

  render() {
    return (
      <Color reset>
        <div>
          {this.state.logs.map((log, i) => (
            <Log key={i} event={log} />
          ))}
          {this.state.progress ? (
            <Progress event={this.state.progress} />
          ) : null}
          {this.props.options.mode === 'production' &&
          this.state.bundleGraph ? (
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
  state: State,
  event: ReporterEvent,
  options: ParcelOptions
): State {
  let logLevel = logLevels[options.logLevel];

  switch (event.type) {
    case 'buildStart':
      if (logLevel < logLevels.info) {
        break;
      }

      return {
        ...state,
        logs: [],
        bundleGraph: null
      };

    case 'buildProgress':
      if (logLevel < logLevels.progress) {
        break;
      }

      var message = getProgressMessage(event);
      var progress = state.progress;
      if (message != null) {
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
      if (logLevel < logLevels.info) {
        break;
      }

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
      if (logLevel < logLevels.error) {
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
      if (logLevel < logLevels[event.level]) {
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
