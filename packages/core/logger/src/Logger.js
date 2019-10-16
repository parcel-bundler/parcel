// @flow strict-local

import type {IDisposable, LogEvent} from '@parcel/types';

import {ValueEmitter} from '@parcel/events';
import {inspect} from 'util';
import type {Diagnostic} from '@parcel/diagnostic';

class Logger {
  #logEmitter = new ValueEmitter<LogEvent>();

  onLog(cb: (event: LogEvent) => mixed): IDisposable {
    return this.#logEmitter.addListener(cb);
  }

  verbose(message: string): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'verbose',
      message
    });
  }

  info(diagnostic: Diagnostic): void {
    this.log(diagnostic);
  }

  log(diagnostic: Diagnostic): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'info',
      diagnostic
    });
  }

  warn(diagnostic: Diagnostic): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'warn',
      diagnostic
    });
  }

  error(diagnostic: Diagnostic): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'error',
      diagnostic
    });
  }

  progress(message: string): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'progress',
      message
    });
  }
}

const logger = new Logger();
export default logger;

let consolePatched = false;

// Patch `console` APIs within workers to forward their messages to the Logger
// at the appropriate levels.
// TODO: Implement the rest of the console api as needed.
// TODO: Does this need to be disposable/reversible?
export function patchConsole() {
  if (consolePatched) {
    return;
  }

  /* eslint-disable no-console */
  // $FlowFixMe
  console.log = console.info = (...messages: Array<mixed>) => {
    logger.info(messagesToDiagnostic(messages));
  };

  // $FlowFixMe
  console.debug = (...messages: Array<mixed>) => {
    // TODO: dedicated debug level?
    logger.verbose(joinLogMessages(messages));
  };

  // $FlowFixMe
  console.warn = (...messages: Array<mixed>) => {
    logger.warn(messagesToDiagnostic(messages));
  };

  // $FlowFixMe
  console.error = (...messages: Array<mixed>) => {
    logger.error(messagesToDiagnostic(messages));
  };

  /* eslint-enable no-console */
  consolePatched = true;
}

function messagesToDiagnostic(messages: Array<mixed>): Diagnostic {
  if (messages.length === 1 && messages[0] instanceof Error) {
    let error: Error = messages[0];

    return {
      message: error.message,
      origin: '@parcel/logger',
      stack: error.stack
    };
  } else {
    return {
      message: joinLogMessages(messages),
      origin: '@parcel/logger'
    };
  }
}

function joinLogMessages(messages: Array<mixed>): string {
  return messages.map(m => (typeof m === 'string' ? m : inspect(m))).join(' ');
}
