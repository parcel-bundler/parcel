// @flow
import assert from 'assert';
import {sleep} from '@parcel/test-utils';
import randomInt from 'random-int';

import PromiseQueue from '../src/PromiseQueue';

describe('PromiseQueue', () => {
  it('run() should resolve when all async functions in queue have completed', async () => {
    let queue = new PromiseQueue();

    let someBooleanToBeChanged = false;
    queue.add(() =>
      Promise.resolve().then(() => {
        someBooleanToBeChanged = true;
      })
    );
    await queue.run();
    assert(someBooleanToBeChanged);
  });

  it('run() should reject if any of the async functions in the queue failed', async () => {
    let error = new Error('some failure');
    try {
      let queue = new PromiseQueue();
      queue.add(() => Promise.reject(error));
      await queue.run();
    } catch (e) {
      assert.equal(e, error);
    }
  });

  it('.run() should instantly resolve when the queue is empty', async () => {
    let queue = new PromiseQueue();
    await queue.run();
    // no need to assert, test will hang or throw an error if condition fails
  });

  it('constructor() should allow for configuration of max concurrent running functions', async () => {
    const maxConcurrent = 5;
    const queue = new PromiseQueue({maxConcurrent});
    let running = 0;

    const input = new Array(100).fill(0).map(() =>
      queue.add(async () => {
        running++;
        assert(queue._numRunning === running);
        assert(running <= maxConcurrent);
        await sleep(randomInt(30, 200));
        running--;
      })
    );

    await Promise.all(input);
  });
});
