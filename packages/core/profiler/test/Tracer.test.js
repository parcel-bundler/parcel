import {tracer, PluginTracer} from '../src/Tracer';
import sinon from 'sinon';
import assert from 'assert';

describe('Tracer', () => {
  let onTrace;
  let traceDisposable;
  beforeEach(() => {
    onTrace = sinon.spy();
    traceDisposable = tracer.onTrace(onTrace);
    tracer.enable();
  });
  afterEach(() => {
    traceDisposable.dispose();
  });

  it('returns no measurement when disabled', () => {
    tracer.disable();
    const measurement = tracer.createMeasurement('test');
    assert(measurement == null);
    assert(onTrace.notCalled);
  });
  it('emits a basic trace event', () => {
    const measurement = tracer.createMeasurement('test');
    measurement.end();
    sinon.assert.calledWith(
      onTrace,
      sinon.match({
        type: 'trace',
        name: 'test',
        args: undefined,
        duration: sinon.match.number,
      }),
    );
  });
  it('emits a complex trace event', () => {
    const measurement = tracer.createMeasurement('test', 'myPlugin', 'aaargh', {
      extra: 'data',
    });
    measurement.end();
    sinon.assert.calledWith(
      onTrace,
      sinon.match({
        type: 'trace',
        name: 'test',
        categories: ['myPlugin'],
        args: {extra: 'data', name: 'aaargh'},
        duration: sinon.match.number,
      }),
    );
  });
  it('calling end twice on measurment should be a no-op', () => {
    const measurement = tracer.createMeasurement('test');
    measurement.end();
    measurement.end();
    sinon.assert.calledOnce(onTrace);
  });

  describe('PluginTracer', () => {
    it('emits events with proper origin/category', () => {
      const pluginTracer = new PluginTracer({
        origin: 'origin',
        category: 'cat',
      });
      const measurement = pluginTracer.createMeasurement('test', 'customCat');
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
