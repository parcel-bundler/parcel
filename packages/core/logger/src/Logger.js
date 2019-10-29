// @flow strict-local

import type {IDisposable, LogEvent} from '@parcel/types';
import type {Diagnostic, Diagnostifiable} from '@parcel/diagnostic';

import {ValueEmitter} from '@parcel/events';
import {inspect} from 'util';
import {errorToDiagnostic, anyToDiagnostic} from '@parcel/diagnostic';

export type PluginInputDiagnostic = {|
  ...Diagnostic,
  origin?: string
|};

class Logger {
  #logEmitter = new ValueEmitter<LogEvent>();

  onLog(cb: (event: LogEvent) => mixed): IDisposable {
    return this.#logEmitter.addListener(cb);
  }

  verbose(diagnostic: Diagnostic | Array<Diagnostic>): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'verbose',
      diagnostic: Array.isArray(diagnostic) ? diagnostic : [diagnostic]
    });
  }

  info(diagnostic: Diagnostic | Array<Diagnostic>): void {
    this.log(diagnostic);
  }

  log(diagnostic: Diagnostic | Array<Diagnostic>): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'info',
      diagnostic: Array.isArray(diagnostic) ? diagnostic : [diagnostic]
    });
  }

  warn(diagnostic: Diagnostic | Array<Diagnostic>): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'warn',
      diagnostic: Array.isArray(diagnostic) ? diagnostic : [diagnostic]
    });
  }

  error(input: Diagnostifiable, realOrigin?: string): void {
    // $FlowFixMe origin is undefined on PluginInputDiagnostic
    let diagnostic = anyToDiagnostic(input);
    if (typeof realOrigin === 'string') {
      diagnostic = Array.isArray(diagnostic)
        ? diagnostic.map(d => {
            return {...d, origin: realOrigin};
          })
        : {
            ...diagnostic,
            origin: realOrigin
          };
    }

    this.#logEmitter.emit({
      type: 'log',
      level: 'error',
      diagnostic: Array.isArray(diagnostic) ? diagnostic : [diagnostic]
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

export type PluginLoggerOpts = {|
  origin: string
|};

export class PluginLogger {
  origin: string;

  constructor(opts: PluginLoggerOpts) {
    this.origin = opts.origin;
  }

  verbose(diagnostic: PluginInputDiagnostic): void {
    logger.verbose({...diagnostic, origin: this.origin});
  }

  info(diagnostic: PluginInputDiagnostic): void {
    logger.info({...diagnostic, origin: this.origin});
  }

  log(diagnostic: PluginInputDiagnostic): void {
    logger.log({...diagnostic, origin: this.origin});
  }

  warn(diagnostic: PluginInputDiagnostic): void {
    logger.warn({...diagnostic, origin: this.origin});
  }

  error(input: Diagnostifiable): void {
    logger.error(input);
  }

  progress(message: string): void {
    logger.progress(message);
  }
}

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
    logger.verbose(messagesToDiagnostic(messages));
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

function messagesToDiagnostic(
  messages: Array<mixed>
): Diagnostic | Array<Diagnostic> {
  if (messages.length === 1 && messages[0] instanceof Error) {
    let error: Error = messages[0];

    return errorToDiagnostic(error);
  } else {
    return {
      message: joinLogMessages(messages),
      origin: 'console'
    };
  }
}

function joinLogMessages(messages: Array<mixed>): string {
  return messages.map(m => (typeof m === 'string' ? m : inspect(m))).join(' ');
}
