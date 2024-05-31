// @flow strict-local

import WorkerFarm from '@parcel/workers';
import path from 'path';
import assert from 'assert';
import sinon from 'sinon';
import {MemoryFS} from '@parcel/fs';
import {hashString} from '@parcel/rust';

import type {
  ConfigRequest,
  ConfigRequestResult,
} from '../../src/requests/ConfigRequest';
import type {RunAPI} from '../../src/RequestTracker';
import {runConfigRequest} from '../../src/requests/ConfigRequest';
import {toProjectPath} from '../../src/projectPath';

// $FlowFixMe unclear-type forgive me
const mockCast = (f: any): any => f;

describe('ConfigRequest tests', () => {
  const projectRoot = 'project_root';
  const farm = new WorkerFarm({
    workerPath: require.resolve('../../src/worker.js'),
    maxConcurrentWorkers: 1,
  });
  let fs = new MemoryFS(farm);
  beforeEach(() => {
    fs = new MemoryFS(farm);
  });

  const getMockRunApi = (
    options: mixed = {projectRoot, inputFS: fs},
  ): RunAPI<ConfigRequestResult> => {
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

  it('can execute a config request', async () => {
    const mockRunApi = getMockRunApi();
    await runConfigRequest(mockRunApi, {
      ...baseRequest,
    });
  });

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
      mockCast(mockRunApi.invalidateOnOptionChange).calledWithMatch('option1'),
      'Invalidate was called for option1',
    );
    assert(
      mockCast(mockRunApi.invalidateOnOptionChange).calledWithMatch('option2'),
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

  it('forwards "invalidateOnConfigKeyChange" calls to runAPI', async () => {
    await fs.mkdirp('/project_root');
    await fs.writeFile(
      '/project_root/config.json',
      JSON.stringify({key1: 'value1'}),
    );
    sinon.spy(fs, 'readFile');
    sinon.spy(fs, 'readFileSync');
    const mockRunApi = getMockRunApi();
    await runConfigRequest(mockRunApi, {
      ...baseRequest,
      invalidateOnConfigKeyChange: [
        {
          configKey: 'key1',
          filePath: toProjectPath(
            projectRoot,
            path.join('project_root', 'config.json'),
          ),
        },
      ],
    });

    const fsCall = mockCast(fs).readFile.getCall(0);
    assert.deepEqual(
      fsCall?.args,
      [path.join('project_root', 'config.json'), 'utf8'],
      'readFile was called',
    );

    const call = mockCast(mockRunApi.invalidateOnConfigKeyChange).getCall(0);
    assert.deepEqual(
      call.args,
      ['config.json', 'key1', hashString('"value1"')],
      'Invalidate was called for key1',
    );
  });
});
