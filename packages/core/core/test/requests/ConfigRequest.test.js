// @flow strict-local

import {setFeatureFlags, DEFAULT_FEATURE_FLAGS} from '@parcel/feature-flags';
import assert from 'assert';

import {runConfigRequest} from '../../src/requests/ConfigRequest';
import type {RunAPI} from '../../src/RequestTracker';
import sinon from 'sinon';
import {toProjectPath} from '../../src/projectPath';
import type {ConfigRequest} from '../../src/requests/ConfigRequest';

// $FlowFixMe unclear-type forgive me
const mockCast = (f: any): any => f;

describe('ConfigRequest tests', () => {
  const projectRoot = '';
  const getMockRunApi = (options: mixed = {projectRoot}): RunAPI<mixed> => {
    const mockRunApi = {
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
        return request.run({
          api: mockRunApi,
          options,
        });
      }),
    };
    return mockRunApi;
  };

  const baseRequest: ConfigRequest = {
    id: 'config_request_test',
    invalidateOnBuild: false,
    invalidateOnConfigKeyChange: [],
    invalidateOnFileCreate: [],
    invalidateOnEnvChange: new Set(),
    invalidateOnOptionChange: new Set(),
    invalidateOnStartup: false,
    invalidateOnFileChange: new Set(),
  };

  [('rust', 'js')].forEach(backend => {
    describe(`${backend} backed`, () => {
      beforeEach(() => {
        setFeatureFlags({
          ...DEFAULT_FEATURE_FLAGS,
          parcelV3: backend === 'rust',
        });
      });

      it('can execute a config request', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
        });
      });

      if (backend === 'rust') {
        // Adding this here mostly to prove that the rust backend is actually running on
        // this suite
        it('errors out if the options are missing projectRoot', async () => {
          const mockRunApi = getMockRunApi({});
          let error: Error | null = null;
          try {
            await runConfigRequest(mockRunApi, {
              ...baseRequest,
            });
          } catch (e) {
            error = e;
          }

          assert.equal(
            error?.message,
            '[napi] Missing required projectRoot options field',
          );
        });
      }

      it('forwards "invalidateOnFileChange" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
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
        assert(
          mockCast(mockRunApi.invalidateOnFileUpdate).calledWith('path2'),
          'Invalidate was called with path2',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileDelete).calledWith('path1'),
          'Invalidate was called with path1',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileDelete).calledWith('path2'),
          'Invalidate was called with path2',
        );
      });

      it('forwards "invalidateOnFileCreate" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
          invalidateOnFileCreate: [
            {filePath: toProjectPath(projectRoot, 'filePath')},
            {glob: toProjectPath(projectRoot, 'glob')},
            {
              fileName: 'package.json',
              aboveFilePath: toProjectPath(projectRoot, 'fileAbove'),
            },
          ],
        });

        assert(
          mockCast(mockRunApi.invalidateOnFileCreate).called,
          'Invalidate was called',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileCreate).calledWithMatch({
            filePath: 'filePath',
          }),
          'Invalidate was called for path',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileCreate).calledWithMatch({
            glob: 'glob',
          }),
          'Invalidate was called for glob',
        );
        assert(
          mockCast(mockRunApi.invalidateOnFileCreate).calledWithMatch({
            fileName: 'package.json',
            aboveFilePath: 'fileAbove',
          }),
          'Invalidate was called for fileAbove',
        );
      });

      it('forwards "invalidateOnEnvChange" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
          invalidateOnEnvChange: new Set(['env1', 'env2']),
        });

        assert(
          mockCast(mockRunApi.invalidateOnEnvChange).called,
          'Invalidate was called',
        );
        assert(
          mockCast(mockRunApi.invalidateOnEnvChange).calledWithMatch('env1'),
          'Invalidate was called for env1',
        );
        assert(
          mockCast(mockRunApi.invalidateOnEnvChange).calledWithMatch('env2'),
          'Invalidate was called for env1',
        );
      });

      it('forwards "invalidateOnOptionChange" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
          invalidateOnOptionChange: new Set(['option1', 'option2']),
        });

        assert(
          mockCast(mockRunApi.invalidateOnOptionChange).called,
          'Invalidate was called',
        );
        assert(
          mockCast(mockRunApi.invalidateOnOptionChange).calledWithMatch(
            'option1',
          ),
          'Invalidate was called for option1',
        );
        assert(
          mockCast(mockRunApi.invalidateOnOptionChange).calledWithMatch(
            'option2',
          ),
          'Invalidate was called for option2',
        );
      });

      it('forwards "invalidateOnStartup" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
          invalidateOnStartup: true,
        });

        assert(
          mockCast(mockRunApi.invalidateOnStartup).called,
          'Invalidate was called',
        );
      });

      it('forwards "invalidateOnBuild" calls to runAPI', async () => {
        const mockRunApi = getMockRunApi();
        await runConfigRequest(mockRunApi, {
          ...baseRequest,
          invalidateOnBuild: true,
        });

        assert(
          mockCast(mockRunApi.invalidateOnBuild).called,
          'Invalidate was called',
        );
      });
    });
  });
});
