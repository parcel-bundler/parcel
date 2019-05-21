// @flow strict-local

import type {
  BundleGraph,
  LogEvent,
  ParcelOptions,
  ProgressLogEvent,
  ReporterEvent
} from '@parcel/types';
import type {RerenderFunc} from 'ink';

import {prettifyTime} from '@parcel/utils';
import {render} from 'ink';
import {Reporter} from '@parcel/plugin';
import React from 'react';

import {getProgressMessage} from './utils';
import logLevels from './logLevels';
import UI from './UI';

type State = {|
  progress: ?ProgressLogEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
|};

let state: State = {
  progress: null,
  logs: [],
  bundleGraph: null
};
let rerender: RerenderFunc;

export default new Reporter({
  report(event, options) {
    let newState = reducer(state, event, options);
    let uiElement = <UI {...newState} options={options} />;
    if (rerender) {
      rerender(uiElement);
    } else {
      render(uiElement);
    }
  }
});

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

    case 'buildProgress': {
      if (logLevel < logLevels.progress) {
        break;
      }

      let message = getProgressMessage(event);
      let progress = state.progress;
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
    }

    case 'buildSuccess':
      if (logLevel < logLevels.info) {
        break;
      }

      return {
        ...state,
        progress: null,
        bundleGraph: event.bundleGraph,
        logs: [
          ...state.logs,
          {
            type: 'log',
            level: 'success',
            message: `Built in ${prettifyTime(event.buildTime)}.`
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

    case 'log': {
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
      let messages = new Set(state.logs.map(l => l.message));
      if (messages.has(event.message)) {
        break;
      }

      return {
        ...state,
        logs: [...state.logs, event]
      };
    }
  }

  return state;
}
