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

  describe('createTraceMeasurement()', () => {
    it('throws an error when tracing is disabled', () => {
      tracer.disable();

      assert.throws(
        () => tracer.createTraceMeasurement(opts),
        new Error(
          'Unable to create a trace measurement when tracing is disabled',
        ),
      );
    });

    it('emits basic trace events', () => {
      let measurement = tracer.createTraceMeasurement(opts);

      sinon.assert.calledOnce(onTrace);
      sinon.assert.calledWith(
        onTrace,
        sinon.match({
          type: 'traceStart',
          args: {traceId: measurement.traceId},
          categories: ['tracer'],
          name: 'test',
        }),
      );

      measurement.end();

      sinon.assert.calledWith(
        onTrace,
        sinon.match({
          type: 'trace',
          args: {traceId: measurement.traceId},
          categories: ['tracer'],
          duration: sinon.match.number,
          name: 'test',
        }),
      );
    });

    it('emits complex trace events', () => {
      let measurement = tracer.createTraceMeasurement({
        ...opts,
        args: {hello: 'world'},
      });

      sinon.assert.calledOnce(onTrace);
      sinon.assert.calledWith(
        onTrace,
        sinon.match({
          type: 'traceStart',
          args: {traceId: measurement.traceId, hello: 'world'},
          categories: ['tracer'],
          name: 'test',
        }),
      );

      measurement.end();

      sinon.assert.calledWith(
        onTrace,
        sinon.match({
          type: 'trace',
          args: {traceId: measurement.traceId, hello: 'world'},
          categories: ['tracer'],
          duration: sinon.match.number,
          name: 'test',
        }),
      );
    });
  });

  describe('PluginTracer', () => {
    const pluginTracer = new PluginTracer({
      origin: 'origin',
      category: 'cat',
    });

    describe('createTraceMeasurement()', () => {
      it('emits events with origin and category', () => {
        let measurement = pluginTracer.createTraceMeasurement(opts);

        sinon.assert.calledOnce(onTrace);
        sinon.assert.calledWith(
          onTrace,
          sinon.match({
            type: 'traceStart',
            args: {traceId: measurement.traceId, origin: 'origin'},
            categories: ['cat', 'tracer'],
            name: 'test',
          }),
        );

        measurement.end();

        sinon.assert.calledWith(
          onTrace,
          sinon.match({
            type: 'trace',
            name: 'test',
            args: {traceId: measurement.traceId, origin: 'origin'},
            categories: ['cat', 'tracer'],
            duration: sinon.match.number,
          }),
        );
      });
    });

    describe('createMeasurement()', () => {
      it('emits events with origin and category', () => {
        let measurement = pluginTracer.createMeasurement('test', 'customCat');

        sinon.assert.calledOnce(onTrace);
        sinon.assert.calledWith(
          onTrace,
          sinon.match({
            type: 'traceStart',
            name: 'test',
            categories: ['cat:origin:customCat'],
          }),
        );

        measurement.end();

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
