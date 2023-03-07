import {
  applicationProfiler,
  PluginApplicationProfiler,
} from '../src/ApplicationProfiler';
import sinon from 'sinon';
import assert from 'assert';

describe('ApplicationProfiler', () => {
  let onTrace;
  let traceDisposable;
  beforeEach(() => {
    onTrace = sinon.spy();
    traceDisposable = applicationProfiler.onTrace(onTrace);
    applicationProfiler.enable();
  });
  afterEach(() => {
    traceDisposable.dispose();
  });

  it('returns no measurement when disabled', () => {
    applicationProfiler.disable();
    const measurement = applicationProfiler.createMeasurement('test');
    assert(measurement == null);
    assert(onTrace.notCalled);
  });
  it('emits a basic trace event', () => {
    const measurement = applicationProfiler.createMeasurement('test');
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
    const measurement = applicationProfiler.createMeasurement(
      'test',
      'myPlugin',
      'aaargh',
      {extra: 'data'},
    );
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
    const measurement = applicationProfiler.createMeasurement('test');
    measurement.end();
    measurement.end();
    sinon.assert.calledOnce(onTrace);
  });

  describe('PluginApplicationProfiler', () => {
    it('emits events with proper origin/category', () => {
      const pluginProfiler = new PluginApplicationProfiler({
        origin: 'origin',
        category: 'cat',
      });
      const measurement = pluginProfiler.createMeasurement('test', 'customCat');
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
