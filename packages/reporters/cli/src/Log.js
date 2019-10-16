// @flow strict-local

import type {
  ServerOptions,
  LogEvent,
  DiagnosticLogEvent,
  TextLogEvent,
  ProgressLogEvent
} from '@parcel/types';

import {prettyError} from '@parcel/utils';
import {Box, Text, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import * as Emoji from './emoji';

type LogProps = {
  event: LogEvent,
  ...
};

type DiagnosticLogProps = {
  event: DiagnosticLogEvent,
  ...
};

type TextLogProps = {
  event: TextLogEvent,
  ...
};

type ProgressLogProps = {
  event: ProgressLogEvent,
  ...
};

type ServerInfoProps = {|
  options: ServerOptions
|};

export function Log({event}: LogProps) {
  switch (event.level) {
    case 'verbose':
    case 'info':
      return <InfoLog event={event} />;
    case 'progress':
      return <Progress event={event} />;
    case 'success':
      return <SuccessLog event={event} />;
    case 'error':
      return <ErrorLog event={event} />;
    case 'warn':
      return <WarnLog event={event} />;
  }

  throw new Error('Unknown log event type');
}

function InfoLog({event}: DiagnosticLogProps) {
  return <Text>{event.diagnostic.message}</Text>;
}

function Stack({
  err,
  emoji,
  color,
  ...otherProps
}: {
  err: string | Error,
  emoji: string,
  color: string,
  ...
}) {
  let {message, stack} = prettyError(err, {color: true});
  return (
    <React.Fragment>
      <div>
        <Color keyword={color} {...otherProps}>
          {emoji} {message}
        </Color>
      </div>
      {stack != null && stack !== '' ? (
        <div>
          <Color gray>{stack}</Color>
        </div>
      ) : null}
    </React.Fragment>
  );
}

function WarnLog({event}: DiagnosticLogProps) {
  return (
    <Stack
      err={event.diagnostic.message}
      emoji={Emoji.warning}
      color="yellow"
    />
  );
}

function ErrorLog({event}: DiagnosticLogProps) {
  return (
    <Stack
      err={event.diagnostic.message}
      emoji={Emoji.error}
      color="red"
      bold
    />
  );
}

function SuccessLog({event}: TextLogProps) {
  return (
    <Color green bold>
      {Emoji.success} {event.message}
    </Color>
  );
}

export function Progress({event}: ProgressLogProps) {
  return (
    <Box>
      <Color gray bold>
        <Spinner /> {event.message}
      </Color>
    </Box>
  );
}

export function ServerInfo({options}: ServerInfoProps) {
  let url = `${options.https ? 'https' : 'http'}://${options.host ??
    'localhost'}:${options.port}`;
  return (
    <Color bold>
      Server running at <Color cyan>{url}</Color>
    </Color>
  );
}
