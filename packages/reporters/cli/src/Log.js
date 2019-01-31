// @flow
import {LogEvent} from '@parcel/types';
import {Box, Text, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import prettyError from '@parcel/logger/src/prettyError';
import emoji from '@parcel/logger/src/emoji';

type LogProps = {
  log: LogEvent
};

let logTypes = {
  info: InfoLog,
  verbose: InfoLog,
  warn: WarnLog,
  error: ErrorLog,
  success: SuccessLog
};

export function Log({log}: LogProps) {
  let LogType = logTypes[log.level];
  return <LogType log={log} />;
}

function InfoLog({log}) {
  return <Text>{log}</Text>;
}

function Stack({err, emoji, color, bold}) {
  let {message, stack} = prettyError(err, {color: true});
  return (
    <React.Fragment>
      <div>
        <Color keyword={color} bold={bold}>
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

function WarnLog({log}) {
  return <Stack err={log.message} emoji={emoji.warning} color="yellow" />;
}

function ErrorLog({log}) {
  return <Stack err={log.message} emoji={emoji.error} color="red" bold />;
}

function SuccessLog({log}) {
  return (
    <Color green bold>
      {emoji.success} {log.message}
    </Color>
  );
}

export function Progress({event}) {
  return (
    <Box>
      <Color gray bold>
        <Spinner /> {event.message}
      </Color>
    </Box>
  );
}
