// @flow strict-local

import type {
  BundleGraph,
  LogEvent,
  PluginOptions,
  ProgressLogEvent,
  ReporterEvent,
} from '@parcel/types';
import type {ValueEmitter} from '@parcel/events';

import {Color} from 'ink';
import React, {useLayoutEffect, useReducer} from 'react';
import {Log, Progress, ServerInfo} from './Log';
import BundleReport from './BundleReport';
import {getProgressMessage} from './utils';
import logLevels from './logLevels';
import {prettifyTime, throttle} from '@parcel/utils';

type Props = {|
  events: ValueEmitter<ReporterEvent>,
  options: PluginOptions,
|};

type State = {|
  progress: ?ProgressLogEvent,
  logs: Array<LogEvent>,
  bundleGraph: ?BundleGraph,
|};

const defaultState: State = {
  progress: null,
  logs: [],
  bundleGraph: null,
};

export default function UI({events, options}: Props) {
  let [state, dispatch] = useReducer(
    (state, event) => reducer(state, event, options),
    defaultState,
  );

  useLayoutEffect(() => {
    const throttledDispatch = throttle(dispatch, 100);
    const enhancedDispatch = event => {
      if (
        event.type === 'buildProgress' &&
        event.phase === state.progress?.phase
      ) {
        throttledDispatch(event);
      } else {
        dispatch(event);
      }
    };
    return events.addListener(enhancedDispatch).dispose;
  }, [events, state.progress?.phase]);

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

const getMessageIdentifier = (l: LogEvent) => {
  // $FlowFixMe this is a sketchy null check...
  if (l.message) {
    return l.message;
  } else if (l.diagnostics) {
    return l.diagnostics.reduce(
      (acc, d) =>
        acc +
        d.message +
        (d.origin || '') +
        (d.codeFrame ? d.codeFrame.code : ''),
      '',
    );
  } else {
    return '';
  }
};

function reducer(
  state: State,
  event: ReporterEvent,
  options: PluginOptions,
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
        bundleGraph: null,
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
          phase: event.phase,
          message,
        };
      }

      return {
        ...state,
        progress,
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
            message: `Built in ${prettifyTime(event.buildTime)}.`,
          },
        ],
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
            diagnostics: event.diagnostics,
          },
        ],
      };

    case 'log': {
      if (logLevel < logLevels[event.level]) {
        break;
      }

      if (event.level === 'progress') {
        return {
          ...state,
          progress: event,
        };
      }

      // Skip duplicate logs
      let messages = new Set(state.logs.map(getMessageIdentifier));
      if (messages.has(getMessageIdentifier(event))) {
        break;
      }

      return {
        ...state,
        logs: [...state.logs, event],
      };
    }
  }

  return state;
}
