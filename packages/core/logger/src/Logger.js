// @flow strict-local

import type {IDisposable, LogEvent} from '@parcel/types';

import EventEmitter from 'events';

class Logger {
  // TODO: This can't be explicitly annotated as an EventEmitter since
  // declared private properties with type annotations break eslint's
  // no-unused-var rule (even with babel-eslint). Annotate this when
  // things aren't broken: https://github.com/babel/babel-eslint/issues/688
  #emitter = new EventEmitter();

  onLog(cb: (event: LogEvent) => mixed): IDisposable {
    this.#emitter.addListener('log', cb);
    return {
      dispose: () => {
        this.#emitter.removeListener('log', cb);
      }
    };
  }

  verbose(message: string): void {
    this.#emitter.emit('log', {
      type: 'log',
      level: 'verbose',
      message
    });
  }

  info(message: string): void {
    this.log(message);
  }

  log(message: string): void {
    this.#emitter.emit('log', {
      type: 'log',
      level: 'info',
      message
    });
  }

  warn(err: Error | string): void {
    this.#emitter.emit('log', {
      type: 'log',
      level: 'warn',
      message: err
    });
  }

  error(err: Error | string): void {
    this.#emitter.emit('log', {
      type: 'log',
      level: 'error',
      message: err
    });
  }

  progress(message: string): void {
    this.#emitter.emit('log', {
      type: 'log',
      level: 'progress',
      message
    });
  }
}

const logger = new Logger();
export default logger;
