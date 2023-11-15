// @flow strict-local

import assert from 'assert';
import nullthrows from 'nullthrows';
import RequestTracker, {
  type RunAPI,
  type Request,
  type RequestType,
  type RunRequestOpts,
} from '../src/RequestTracker';
import WorkerFarm from '@parcel/workers';
import {DEFAULT_OPTIONS} from './test-utils';
import {INITIAL_BUILD} from '../src/constants';
import {makeDeferredWithPromise} from '@parcel/utils';

const options = DEFAULT_OPTIONS;
const farm = new WorkerFarm({workerPath: require.resolve('../src/worker.js')});

type MockRequest<TInput, TResult> = {
  ...Request<TInput, TResult>,
  type: RequestType | 'mock_request',
  ...
};

const extractRequestType = <TInput, TResult>(
  request: MockRequest<TInput, TResult>,
): Request<TInput, TResult> => {
  let newRequest: ?Request<TInput, TResult>;
  if (request.type === 'mock_request') {
    newRequest = {
      id: request.id,
      // For Flow: Mock all mock_request types to parcel_build_request
      type: 'parcel_build_request',
      input: request.input,
      run: request.run,
    };
  } else {
    newRequest = {
      id: request.id,
      type: request.type,
      input: request.input,
      run: request.run,
    };
  }
  return newRequest;
};

// eslint-disable-next-line require-await
async function mockRunRequest<TInput, TResult>(
  tracker: RequestTracker,
  request: MockRequest<TInput, TResult>,
  opts?: RunRequestOpts,
): Promise<TResult> {
  const newRequest = extractRequestType(request);
  return tracker.runRequest(newRequest, opts);
}

// eslint-disable-next-line require-await
async function apiMockRunRequest<TInput, TResult>(
  api: RunAPI<TResult>,
  request: MockRequest<TInput, TResult>,
  opts?: RunRequestOpts,
): Promise<TResult> {
  const newRequest = extractRequestType(request);

  return api.runRequest(newRequest, opts);
}

describe('RequestTracker', () => {
  it('should not run requests that have not been invalidated', async () => {
    let tracker = new RequestTracker({farm, options});
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: () => {},
      input: null,
    });
    let called = false;
    await mockRunRequest(tracker, {
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
    await mockRunRequest(tracker, {
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
    await mockRunRequest(tracker, {
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
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await apiMockRunRequest(api, {
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
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async () => {
        await Promise.resolve();
        throw new Error('woops');
      },
      input: null,
    }).then(null, () => {
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
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await apiMockRunRequest(api, {
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
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}) => {
        await apiMockRunRequest(api, {
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
    await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}: {api: RunAPI<string | void>, ...}) => {
        let result = await Promise.resolve('hello');
        api.storeResult(result);
      },
      input: null,
    });
    let result = await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async () => {},
      input: null,
    });
    assert(result === 'hello');
  });

  it('should reject all in progress requests when the abort controller aborts', async () => {
    let tracker = new RequestTracker({farm, options});
    let p = mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async () => {
        await Promise.resolve('hello');
      },
      input: null,
    }).then(null, () => {
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

  it('should not requeue requests if the previous request is still running', async () => {
    let tracker = new RequestTracker({farm, options});
    let lockA = makeDeferredWithPromise();
    let lockB = makeDeferredWithPromise();

    let requestA = mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}: {api: RunAPI<string>, ...}) => {
        await lockA.promise;
        api.storeResult('a');
        return 'a';
      },
      input: null,
    });

    let calledB = false;
    let requestB = mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}: {api: RunAPI<string>, ...}) => {
        calledB = true;
        await lockB.promise;
        api.storeResult('b');
        return 'b';
      },
      input: null,
    });

    lockA.deferred.resolve();
    lockB.deferred.resolve();
    let resultA = await requestA;
    let resultB = await requestB;
    assert.strictEqual(resultA, 'a');
    assert.strictEqual(resultB, 'a');
    assert.strictEqual(calledB, false);

    let cachedResult = await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: () => {},
      input: null,
    });
    assert.strictEqual(cachedResult, 'a');
  });

  it('should requeue requests if the previous request is still running but failed', async () => {
    let tracker = new RequestTracker({farm, options});
    let lockA = makeDeferredWithPromise();
    let lockB = makeDeferredWithPromise();

    let requestA = mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async () => {
        await lockA.promise;
        throw new Error('whoops');
      },
      input: null,
    }).catch(() => {
      // ignore
    });

    let requestB = mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: async ({api}: {api: RunAPI<string | void>, ...}) => {
        await lockB.promise;
        api.storeResult('b');
      },
      input: null,
    });

    lockA.deferred.resolve();
    lockB.deferred.resolve();
    await requestA;
    await requestB;

    let called = false;
    let cachedResult = await mockRunRequest(tracker, {
      id: 'abc',
      type: 'mock_request',
      run: () => {
        called = true;
      },
      input: null,
    });
    assert.strictEqual(cachedResult, 'b');
    assert.strictEqual(called, false);
  });
});
