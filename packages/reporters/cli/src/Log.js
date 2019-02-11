// @flow
import type {LogEvent} from '@parcel/types';
import {Box, Text, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import prettyError from './prettyError';
import emoji from './emoji';

type LogProps = {
  event: LogEvent
};

let logTypes = {
  info: InfoLog,
  progress: Progress,
  verbose: InfoLog,
  warn: WarnLog,
  error: ErrorLog,
  success: SuccessLog
};

export function Log({event}: LogProps) {
  let LogType = logTypes[event.level];
  return <LogType event={event} />;
}

function InfoLog({event}) {
  return <Text>{event.message}</Text>;
}

function Stack({err, emoji, color, ...otherProps}) {
  let {message, stack} = prettyError(err, {color: true});
  return (
    <React.Fragment>
      <div>
        <Color keyword={color} {...otherProps}>
          {emoji} {message}
        </Color>
      </div>
      {stack && (
        <div>
          <Color gray>{stack}</Color>
        </div>
      )}
    </React.Fragment>
  );
}

function WarnLog({event}) {
  return <Stack err={event.message} emoji={emoji.warning} color="yellow" />;
}

function ErrorLog({event}) {
  return <Stack err={event.message} emoji={emoji.error} color="red" bold />;
}

function SuccessLog({event}) {
  return (
    <Color green bold>
      {emoji.success} {event.message}
    </Color>
  );
}

export function Progress({event}: LogProps) {
  return (
    <Box>
      <Color gray bold>
        <Spinner /> {event.message}
      </Color>
    </Box>
  );
}
