// @flow
import type {LogEvent} from '@parcel/types';
import {Box, Text, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import prettyError from './prettyError';
import * as Emoji from './emoji';

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

function InfoLog({event}: LogProps) {
  return <Text>{event.message}</Text>;
}

function Stack({
  err,
  emoji,
  color,
  ...otherProps
}: {
  err: string | Error,
  emoji: string,
  color: string
}) {
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

function WarnLog({event}: LogProps) {
  return <Stack err={event.message} emoji={Emoji.warning} color="yellow" />;
}

function ErrorLog({event}: LogProps) {
  return <Stack err={event.message} emoji={Emoji.error} color="red" bold />;
}

function SuccessLog({event}: LogProps) {
  return (
    <Color green bold>
      {Emoji.success} {event.message}
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
