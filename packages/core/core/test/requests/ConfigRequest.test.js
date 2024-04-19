// @flow strict-local

import {setFeatureFlags, DEFAULT_FEATURE_FLAGS} from '@parcel/feature-flags';
import assert from 'assert';

import {runConfigRequest} from '../../src/requests/ConfigRequest';
import type {RunAPI} from '../../src/RequestTracker';
import sinon from 'sinon';
import {toProjectPath} from '../../src/projectPath';

// $FlowFixMe unclear-type forgive me
const mockCast = (f: any): any => f;

describe('ConfigRequest tests', () => {
  const projectRoot = '';
  const mockRunApi: RunAPI<mixed> = {
    storeResult: sinon.spy(),
    canSkipSubrequest: sinon.spy(),
    invalidateOnFileCreate: sinon.spy(),
    getInvalidSubRequests: sinon.spy(),
    getInvalidations: sinon.spy(),
    getPreviousResult: sinon.spy(),
    getRequestResult: sinon.spy(),
    getSubRequests: sinon.spy(),
    invalidateOnBuild: sinon.spy(),
    invalidateOnConfigKeyChange: sinon.spy(),
    invalidateOnEnvChange: sinon.spy(),
    invalidateOnFileDelete: sinon.spy(),
    invalidateOnFileUpdate: sinon.spy(),
    invalidateOnOptionChange: sinon.spy(),
    invalidateOnStartup: sinon.spy(),
    runRequest: sinon.spy(request => {
      request.run({api: mockRunApi, options: {}});
    }),
  };

  ['rust', 'js'].forEach(backend => {
    describe(`${backend} backed`, () => {
      beforeEach(() => {
        setFeatureFlags({
          ...DEFAULT_FEATURE_FLAGS,
          parcelV3: backend === 'rust',
        });
      });

      it('can execute a config request', async () => {
        await runConfigRequest(mockRunApi, {
          id: 'config_request_test',
          invalidateOnBuild: false,
          invalidateOnConfigKeyChange: [],
          invalidateOnFileCreate: [],
          invalidateOnEnvChange: new Set(),
          invalidateOnOptionChange: new Set(),
          invalidateOnStartup: false,
          invalidateOnFileChange: new Set(),
        });
      });

      it('forwards "invalidateOnFileChange" calls to runAPI', async () => {
        await runConfigRequest(mockRunApi, {
          id: 'config_request_test',
          invalidateOnBuild: false,
          invalidateOnConfigKeyChange: [],
          invalidateOnFileCreate: [],
          invalidateOnEnvChange: new Set(),
          invalidateOnOptionChange: new Set(),
          invalidateOnStartup: false,
          invalidateOnFileChange: new Set([
            toProjectPath(projectRoot, 'path1'),
            toProjectPath(projectRoot, 'path2'),
          ]),
        });

        assert(
          mockCast(mockRunApi.invalidateOnFileUpdate).called,
          'Invalidate was called',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileUpdate).calledWith('path1'),
          'Invalidate was called with path1',
        );
      });
    });
  });
});
