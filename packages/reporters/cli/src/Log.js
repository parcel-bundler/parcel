// @flow strict-local

import type {
  ServerOptions,
  LogEvent,
  DiagnosticLogEvent,
  TextLogEvent,
  ProgressLogEvent
} from '@parcel/types';
import type {Diagnostic, DiagnosticCodeFrame} from '@parcel/diagnostic';
import mdAnsi from '@parcel/markdown-ansi';

import {Box, Color} from 'ink';
import Spinner from './Spinner';
import React from 'react';
import * as Emoji from './emoji';
import formatCodeFrame from './formatCodeFrame';

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

function memoisedMarkdownMessage(msg: string) {
  return React.useMemo(() => mdAnsi(msg), [msg]);
}

function Hints({hints}: {hints: Array<string>, ...}) {
  return (
    <div>
      <div>Hints:</div>
      {hints.map((hint, i) => {
        return <div key={i}>- {memoisedMarkdownMessage(hint)}</div>;
      })}
    </div>
  );
}

function CodeFrame(props: {
  codeframe: DiagnosticCodeFrame,
  filename?: string,
  language?: string,
  ...
}) {
  let {codeframe, filename} = props;
  let highlights = Array.isArray(codeframe.codeHighlights)
    ? codeframe.codeHighlights
    : [codeframe.codeHighlights];

  let formattedCodeFrame = React.useMemo(() => formatCodeFrame(codeframe), [
    codeframe
  ]);

  return (
    <div>
      {`${typeof filename !== 'string' ? '' : filename}@${highlights
        .map(h => {
          return `${h.start.line}:${h.start.column}`;
        })
        .join(',')}`}
      <div>{formattedCodeFrame}</div>
    </div>
  );
}

function DiagnosticContainer({
  diagnostic,
  color,
  emoji
}: {
  diagnostic: Diagnostic,
  color: string,
  emoji: string,
  ...
}) {
  let {
    origin,
    message,
    stack,
    hints,
    codeframe,
    filename,
    language
  } = diagnostic;

  return (
    <React.Fragment>
      <Color keyword={color}>
        <Color bold>{`${emoji} ${origin}`}</Color>{' '}
        {memoisedMarkdownMessage(message)}
      </Color>
      {stack != null && stack !== '' ? (
        <div>
          <Color gray>{stack}</Color>
        </div>
      ) : null}
      {codeframe && (
        <CodeFrame
          codeframe={codeframe}
          filename={filename}
          language={language}
        />
      )}
      {Array.isArray(hints) && hints.length ? <Hints hints={hints} /> : ''}
    </React.Fragment>
  );
}

function InfoLog({event}: DiagnosticLogProps) {
  return (
    <DiagnosticContainer
      diagnostic={event.diagnostic}
      emoji={Emoji.info}
      color="blue"
    />
  );
}

function WarnLog({event}: DiagnosticLogProps) {
  return (
    <DiagnosticContainer
      diagnostic={event.diagnostic}
      emoji={Emoji.warning}
      color="yellow"
    />
  );
}

function ErrorLog({event}: DiagnosticLogProps) {
  return (
    <DiagnosticContainer
      diagnostic={event.diagnostic}
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
