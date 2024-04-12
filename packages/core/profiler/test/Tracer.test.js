import {tracer, PluginTracer} from '../src/Tracer';
import sinon from 'sinon';
import assert from 'assert';

describe('Tracer', () => {
  let onTrace;
  let traceDisposable;
  let opts = {name: 'test', categories: ['tracer']};

  beforeEach(() => {
    onTrace = sinon.spy();
    traceDisposable = tracer.onTrace(onTrace);
    tracer.enable();
  });

  afterEach(() => {
    traceDisposable.dispose();
  });

  describe('measure()', () => {
    let cases = [
      ['synchronous', () => () => {}],
      ['asynchronous', () => async () => {}],
    ];

    for (let [type, createFn] of cases) {
      describe(`given a ${type} function`, () => {
        it('does not trace when disabled', async () => {
          tracer.disable();

          let result = tracer.measure(opts, sinon.spy());
          if (type === 'asynchronous') {
            sinon.assert.notCalled(onTrace);
            await result;
          }

          assert(onTrace.notCalled);
        });

        it('emits a basic trace event', async () => {
          let result = tracer.measure(opts, createFn());
          if (type === 'asynchronous') {
            sinon.assert.notCalled(onTrace);
            await result;
          }

          sinon.assert.calledOnce(onTrace);
          sinon.assert.calledWith(
            onTrace,
            sinon.match({
              type: 'trace',
              name: 'test',
              args: {},
              categories: ['tracer'],
              duration: sinon.match.number,
            }),
          );
        });

        it('emits a complex trace event', async () => {
          let result = tracer.measure(
            {...opts, args: {hello: 'world'}},
            createFn(),
          );
          if (type === 'asynchronous') {
            sinon.assert.notCalled(onTrace);
            await result;
          }

          sinon.assert.calledOnce(onTrace);
          sinon.assert.calledWith(
            onTrace,
            sinon.match({
              type: 'trace',
              name: 'test',
              args: {hello: 'world'},
              categories: ['tracer'],
              duration: sinon.match.number,
            }),
          );
        });
      });
    }
  });

  describe('PluginTracer', () => {
    const pluginTracer = new PluginTracer({
      origin: 'origin',
      category: 'cat',
    });

    describe(`measure()`, () => {
      it('emits events with origin and category', () => {
        pluginTracer.measure(opts, sinon.spy());

        sinon.assert.calledOnce(onTrace);
        sinon.assert.calledWith(
          onTrace,
          sinon.match({
            type: 'trace',
            name: 'test',
            args: {origin: 'origin'},
            categories: ['cat', 'tracer'],
            duration: sinon.match.number,
          }),
        );
      });
    });

    describe('createMeasurement()', () => {
      it('emits events with origin and category', () => {
        pluginTracer.createMeasurement('test', 'customCat').end();

        sinon.assert.calledOnce(onTrace);
        sinon.assert.calledWith(
          onTrace,
          sinon.match({
            type: 'trace',
            name: 'test',
            categories: ['cat:origin:customCat'],
            duration: sinon.match.number,
          }),
        );
      });
    });
  });
});
