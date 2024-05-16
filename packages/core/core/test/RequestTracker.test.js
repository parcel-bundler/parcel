// @flow strict-local

import assert from 'assert';
import nullthrows from 'nullthrows';
import RequestTracker, {type RunAPI} from '../src/RequestTracker';
import WorkerFarm from '@parcel/workers';
import {DEFAULT_OPTIONS} from './test-utils';
import {INITIAL_BUILD} from '../src/constants';
import {makeDeferredWithPromise} from '@parcel/utils';

const options = DEFAULT_OPTIONS;
const farm = new WorkerFarm({workerPath: require.resolve('../src/worker.js')});

describe('RequestTracker', () => {
  it('should not run requests that have not been invalidated', async () => {
    let tracker = new RequestTracker({farm, options});
    await tracker.runRequest({
      id: 'abc',
      type: 7,
      run: () => {},
      input: null,
    });
    let called = false;
    await tracker.runRequest({
      id: 'abc',
      type: 7,
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
      type: 7,
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
      type: 7,
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
      type: 7,
      run: async ({api}) => {
        await api.runRequest({
          id: 'xyz',
          type: 7,
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
        type: 7,
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
      type: 7,
      run: async ({api}) => {
        await api.runRequest({
          id: 'xyz',
          type: 7,
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
      type: 7,
      run: async ({api}) => {
        await api.runRequest({
          id: '123',
          type: 7,
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
      type: 7,
      run: async ({api}: {api: RunAPI<string | void>, ...}) => {
        let result = await Promise.resolve('hello');
        api.storeResult(result);
      },
      input: null,
    });
    let result = await tracker.runRequest({
      id: 'abc',
      type: 7,
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
        type: 7,
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

  it('should write cache to disk and store index', async () => {
    let tracker = new RequestTracker({farm, options});

    await tracker.runRequest({
      id: 'abc',
      type: 7,
      run: async ({api}: {api: RunAPI<string | void>, ...}) => {
        let result = await Promise.resolve();
        api.storeResult(result);
      },
      input: null,
    });

    await tracker.writeToCache();

    assert(tracker.graph.cachedRequestChunks.size > 0);
  });

  it('should not write to cache when the abort controller aborts', async () => {
    let tracker = new RequestTracker({farm, options});

    const abortController = new AbortController();
    abortController.abort();

    await tracker.writeToCache(abortController.signal);

    assert(tracker.graph.cachedRequestChunks.size === 0);
  });

  it('should not requeue requests if the previous request is still running', async () => {
    let tracker = new RequestTracker({farm, options});

    let lockA = makeDeferredWithPromise();
    let lockB = makeDeferredWithPromise();

    let requestA = tracker.runRequest({
      id: 'abc',
      type: 7,
      run: async ({api}: {api: RunAPI<string>, ...}) => {
        await lockA.promise;
        api.storeResult('a');
        return 'a';
      },
      input: null,
    });

    let calledB = false;
    let requestB = tracker.runRequest({
      id: 'abc',
      type: 7,
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

    let cachedResult = await tracker.runRequest({
      id: 'abc',
      type: 7,
      run: () => {},
      input: null,
    });
    assert.strictEqual(cachedResult, 'a');
  });

  it('should requeue requests if the previous request is still running but failed', async () => {
    let tracker = new RequestTracker({farm, options});

    let lockA = makeDeferredWithPromise();
    let lockB = makeDeferredWithPromise();

    let requestA = tracker
      .runRequest({
        id: 'abc',
        type: 7,
        run: async () => {
          await lockA.promise;
          throw new Error('whoops');
        },
        input: null,
      })
      .catch(() => {
        // ignore
      });

    let requestB = tracker.runRequest({
      id: 'abc',
      type: 7,
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
    let cachedResult = await tracker.runRequest({
      id: 'abc',
      type: 7,
      run: () => {
        called = true;
      },
      input: null,
    });
    assert.strictEqual(cachedResult, 'b');
    assert.strictEqual(called, false);
  });

  it('should write new nodes to cache', async () => {
    let tracker = new RequestTracker({farm, options});

    tracker.graph.addNode({
      type: 0,
      id: 'test-file',
    });
    await tracker.writeToCache();
    assert.equal(tracker.graph.nodes.length, 1);

    tracker.graph.addNode({
      type: 0,
      id: 'test-file-2',
    });
    await tracker.writeToCache();
    assert.equal(tracker.graph.nodes.length, 2);

    // Create a new tracker from cache
    tracker = await RequestTracker.init({farm, options});

    await tracker.writeToCache();
    assert.equal(tracker.graph.nodes.length, 2);
  });

  it('should write updated nodes to cache', async () => {
    let tracker = new RequestTracker({farm, options});

    let contentKey = 'abc';
    await tracker.runRequest({
      id: contentKey,
      type: 7,
      run: async ({api}: {api: RunAPI<string | void>, ...}) => {
        let result = await Promise.resolve('a');
        api.storeResult(result);
      },
      input: null,
    });
    assert.equal(await tracker.getRequestResult(contentKey), 'a');
    await tracker.writeToCache();

    await tracker.runRequest(
      {
        id: contentKey,
        type: 7,
        run: async ({api}: {api: RunAPI<string | void>, ...}) => {
          let result = await Promise.resolve('b');
          api.storeResult(result);
        },
        input: null,
      },
      {force: true},
    );
    assert.equal(await tracker.getRequestResult(contentKey), 'b');
    await tracker.writeToCache();

    // Create a new tracker from cache
    tracker = await RequestTracker.init({farm, options});

    assert.equal(await tracker.getRequestResult(contentKey), 'b');
  });

  it('should write invalidated nodes to cache', async () => {
    let tracker = new RequestTracker({farm, options});

    let contentKey = 'abc';
    await tracker.runRequest({
      id: contentKey,
      type: 7,
      run: () => {},
      input: null,
    });
    let nodeId = tracker.graph.getNodeIdByContentKey(contentKey);
    assert.equal(tracker.graph.getNode(nodeId)?.invalidateReason, 0);
    await tracker.writeToCache();

    tracker.graph.invalidateNode(nodeId, 1);
    assert.equal(tracker.graph.getNode(nodeId)?.invalidateReason, 1);
    await tracker.writeToCache();

    // Create a new tracker from cache
    tracker = await RequestTracker.init({farm, options});

    assert.equal(tracker.graph.getNode(nodeId)?.invalidateReason, 1);
  });
});
