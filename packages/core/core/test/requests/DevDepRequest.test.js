// @flow strict-local

// eslint-disable-next-line @parcel/no-self-package-imports
import {clearBuildCaches} from '@parcel/core/src/buildCache';
import {resolveDevDepRequestRef} from '../../src/requests/DevDepRequest';
import type {DevDepRequest, DevDepRequestRef} from '../../src/types';
import {toProjectPath} from '../../src/projectPath';
import assert from 'assert';

describe('DevDepRequest', () => {
  beforeEach(() => {
    clearBuildCaches();
  });

  describe('resolveDevDepRequestRef', () => {
    it('will return requests as is', () => {
      const request: DevDepRequest = {
        specifier: 'test',
        hash: 'hash',
        invalidateOnFileChange: new Set(),
        invalidateOnFileCreate: [],
        invalidateOnStartup: false,
        resolveFrom: toProjectPath('', 'path.js'),
      };
      const result = resolveDevDepRequestRef(request);
      assert.equal(result, request);
    });

    it('will return cached requests for refs', () => {
      const request: DevDepRequest = {
        specifier: 'test',
        hash: 'hash',
        invalidateOnFileChange: new Set(),
        invalidateOnFileCreate: [],
        invalidateOnStartup: false,
        resolveFrom: toProjectPath('', 'path.js'),
      };
      resolveDevDepRequestRef(request);

      const devDepRequestRef: DevDepRequestRef = {
        type: 'ref',
        specifier: 'test',
        hash: 'hash',
        resolveFrom: toProjectPath('', 'path.js'),
      };
      const result = resolveDevDepRequestRef(devDepRequestRef);
      assert.equal(result, request);
    });

    it('will throw for uncached refs', () => {
      const devDepRequestRef: DevDepRequestRef = {
        type: 'ref',
        specifier: 'test',
        hash: 'hash',
        resolveFrom: toProjectPath('', 'path.js'),
      };
      assert.throws(() => {
        resolveDevDepRequestRef(devDepRequestRef);
      });
    });
  });
});
