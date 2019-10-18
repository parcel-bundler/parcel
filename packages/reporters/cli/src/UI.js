// @flow strict-local

import type {
  BundleGraph,
  LogEvent,
  PluginOptions,
  ProgressLogEvent,
  ReporterEvent
} from '@parcel/types';
import type {ValueEmitter} from '@parcel/events';

import {Color} from 'ink';
import React, {useEffect, useReducer} from 'react';
import {Log, Progress, ServerInfo} from './Log';
import BundleReport from './BundleReport';
import {getProgressMessage} from './utils';
import logLevels from './logLevels';
import {prettifyTime} from '@parcel/utils';

type Props = {|
  events: ValueEmitter<ReporterEvent>,
  options: PluginOptions
|};

type State = {|
  progress: ?ProgressLogEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph
|};

const defaultState: State = {
  progress: null,
  logs: [],
  bundleGraph: null
};

export default function UI({events, options}: Props) {
  let [state, dispatch] = useReducer(
    (state, event) => reducer(state, event, options),
    defaultState
  );

  useEffect(() => events.addListener(dispatch).dispose, [events]);

  let {logs, progress, bundleGraph} = state;
  return (
    <Color reset>
      <div>
        {options.serve && <ServerInfo options={options.serve} />}
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

function reducer(
  state: State,
  event: ReporterEvent,
  options: PluginOptions
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
