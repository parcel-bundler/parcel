// @flow strict-local

import type {IDisposable, LogEvent} from '@parcel/types';

import ValueEmitter from '@parcel/value-emitter';

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

  info(message: string): void {
    this.log(message);
  }

  log(message: string): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'info',
      message
    });
  }

  warn(err: Error | string): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'warn',
      message: err
    });
  }

  error(err: Error | string): void {
    this.#logEmitter.emit({
      type: 'log',
      level: 'error',
      message: err
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
