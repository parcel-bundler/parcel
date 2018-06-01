const assert = require('assert');
const sinon = require('sinon');
const Logger = require('../src/Logger');

describe('Logger', () => {
  let log;
  beforeEach(function() {
    log = [];
  });

  const stub = instance => {
    sinon.stub(instance, '_log').callsFake(message => {
      log.push(message);
    });
  };

  it('should log message on write', () => {
    const l = new Logger.constructor({});
    stub(l);

    l.write('hello');
    assert.equal(log[0], 'hello');
  });

  it('should track number of lines on persist false', () => {
    const l = new Logger.constructor({});
    stub(l);

    const count = l.lines;
    l.write('hello\nworld', false);
    assert.equal(l.lines, count + 2);
  });

  it('should not track number of lines on persist true', () => {
    const l = new Logger.constructor({});
    stub(l);

    const count = l.lines;
    l.write('hello\nworld', true);
    assert.equal(l.lines, count);
  });

  it('should respect log levels', () => {
    const l = new Logger.constructor({logLevel: 2, color: false});
    stub(l);

    l.log('message');
    l.persistent('message');
    l.status('🚨', 'message');
    l.logLevel = 1;
    l.warn('message');
    l.logLevel = 0;
    l.error({message: 'message', stack: 'stack'});

    assert.equal(log.length, 0);

    l.logLevel = 1;
    l.error({message: 'message', stack: 'stack'});
    assert.equal(log.length, 2);

    l.logLevel = 2;
    l.warn('message');
    assert.equal(log.length, 3);

    l.logLevel = 3;
    l.log('message');
    l.persistent('message');
    l.status('🚨', 'message');
    assert.equal(log.length, 6);
  });

  it('should handle lack of color support with alternatives', () => {
    const l = new Logger.constructor({color: false});
    stub(l);

    // clear is a no-op
    l.lines = 4;
    l.statusLine = 'hello';
    l.clear();
    assert.equal(l.lines, 4);
    assert.equal(l.statusLine, 'hello');

    // write-line calls log
    const spy = sinon.spy(l, 'log');
    l.status('spinner', 'hello', 'red');
    assert(spy.called);
  });

  it('should reset on clear', () => {
    const l = new Logger.constructor({color: true, isTest: false});
    stub(l);

    l.lines = 10;
    l.clear();

    assert.equal(l.lines, 0);
  });

  it('should log emoji and message via status', () => {
    const l = new Logger.constructor({color: false});
    stub(l);
    l.status('🚨', 'hello');

    assert(log[0].includes('🚨'));
    assert(log[0].includes('hello'));
  });

  it('should use internal _log function for writes', () => {
    const l = new Logger.constructor({color: false});
    const sandbox = sinon.createSandbox(); // use sandbox to silence console.log

    let spy;
    try {
      spy = sandbox.spy(l, '_log');
      sandbox.stub(console, 'log');

      l.write('hello world');
    } finally {
      l._log.restore();
      sandbox.restore();
    }

    assert(spy.called);
  });
});
