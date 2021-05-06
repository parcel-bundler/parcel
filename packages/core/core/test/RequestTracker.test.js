// @flow strict-local

import assert from 'assert';
import nullthrows from 'nullthrows';
import RequestTracker from '../src/RequestTracker';
import WorkerFarm from '@parcel/workers';
import {DEFAULT_OPTIONS} from './test-utils';
import {INITIAL_BUILD} from '../src/constants';

const options = DEFAULT_OPTIONS;
const farm = new WorkerFarm({workerPath: require.resolve('../src/worker.js')});

describe('RequestTracker', () => {
  it('should not run requests that have not been invalidated', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: () => {},
      input: null,
    });
    let called = false;
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: () => {
        called = true;
      },
      input: null,
    });
    assert(called === false);
  });

  it('should rerun requests that have been invalidated', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: () => {},
      input: null,
    });
    tracker.graph.invalidateNode(
      tracker.graph.getNodeIdByContentKey('abc'),
      INITIAL_BUILD,
    );
    let called = false;
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: () => {
        called = true;
      },
      input: null,
    });
    assert(called === true);
  });

  it('should invalidate requests with invalidated subrequests', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await api.runRequest({
          id: 'xyz',
          type: 'mock_request',
          run: () => {},
          input: null,
        });
      },
      input: null,
    });
    tracker.graph.invalidateNode(
      tracker.graph.getNodeIdByContentKey('xyz'),
      INITIAL_BUILD,
    );
    assert(
      tracker
        .getInvalidRequests()
        .map(req => req.id)
        .includes('abc'),
    );
  });

  it('should invalidate requests that failed', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker
      .runRequest({
        id: 'abc',
        type: 'mock_request',
        run: async () => {
          await Promise.resolve();
          throw new Error('woops');
        },
        input: null,
      })
      .then(null, () => {
        /* do nothing */
      });
    assert(
      tracker
        .getInvalidRequests()
        .map(req => req.id)
        .includes('abc'),
    );
  });

  it('should remove subrequests that are no longer called within a request', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await api.runRequest({
          id: 'xyz',
          type: 'mock_request',
          run: () => {},
          input: null,
        });
      },
      input: null,
    });
    let nodeId = nullthrows(tracker.graph.getNodeIdByContentKey('abc'));
    tracker.graph.invalidateNode(nodeId, INITIAL_BUILD);
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await api.runRequest({
          id: '123',
          type: 'mock_request',
          run: () => {},
          input: null,
        });
      },
      input: null,
    });
    assert(!tracker.graph.hasContentKey('xyz'));
  });

  it('should return a cached result if it was stored', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        let result = await Promise.resolve('hello');
        api.storeResult(result);
      },
      input: null,
    });
    let result = await await tracker.runRequest({
      id: 'abc',
      type: 'mock_request',
      run: async () => {},
      input: null,
    });
    assert(result === 'hello');
  });

  it('should reject all in progress requests when the abort controller aborts', async () => {
    let tracker = new RequestTracker({farm, options});
    let p = tracker
      .runRequest({
        id: 'abc',
        type: 'mock_request',
        run: async () => {
          await Promise.resolve('hello');
        },
        input: null,
      })
      .then(null, () => {
        /* do nothing */
      });
    // $FlowFixMe
    tracker.setSignal({aborted: true});
    await p;
    assert(
      tracker
        .getInvalidRequests()
        .map(req => req.id)
        .includes('abc'),
    );
  });
});
