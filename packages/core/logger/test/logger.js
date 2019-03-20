// @flow

import assert from 'assert';
import sinon from 'sinon';
import Logger from '../src/Logger';

describe('Logger', () => {
  let onLog;
  let logDisposable;
  beforeEach(() => {
    onLog = sinon.spy();
    logDisposable = Logger.onLog(onLog);
  });

  afterEach(() => {
    logDisposable.dispose();
  });

  it('emits log messages with info level', () => {
    Logger.log('hello');
    assert(onLog.calledWith({level: 'info', message: 'hello', type: 'log'}));
  });

  it('emits warn messages with warn level', () => {
    Logger.warn('zomg');
    assert(onLog.calledWith({level: 'warn', message: 'zomg', type: 'log'}));
  });

  it('emits error messages with error level', () => {
    Logger.error('oh noes');
    assert(onLog.calledWith({level: 'error', message: 'oh noes', type: 'log'}));
  });

  it('emits progress messages with progress level', () => {
    Logger.progress('update');
    assert(
      onLog.calledWith({level: 'progress', message: 'update', type: 'log'})
    );
  });
});
