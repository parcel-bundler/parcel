import createPathRequest from '../src/requests/PathRequest';
import {getCachedParcelConfig} from '../src/requests/ParcelConfigRequest';
import {clearBuildCaches} from '../src/buildCache';
import sinon from 'sinon';
import assert from 'assert';

function createMockedParcelConfig(resolverPlugins, options, config = {}) {
  const configResult = {
    config,
    cachePath: '_cachepath',
  };
  const resolvers = resolverPlugins.map(resolver => {
    return {
      plugin: resolver,
    };
  });
  const parcelConfig = getCachedParcelConfig(configResult, options);
  parcelConfig.getResolvers = () => Promise.resolve(resolvers);
  return configResult;
}

function createApi(configResult) {
  return {
    runRequest: () => Promise.resolve(configResult),
    invalidateOnEnvChange: sinon.spy(),
    invalidateOnFileCreate: sinon.spy(),
    invalidateOnFileUpdate: sinon.spy(),
    invalidateOnFileDelete: sinon.spy(),
  };
}

function setUp(resolverPlugins, options, config = {}) {
  const configResult = createMockedParcelConfig(
    resolverPlugins,
    options,
    config,
  );
  return createApi(configResult);
}

function runPathRequest(runOpts) {
  const pathRequest = createPathRequest({
    name: '',
    dependency: {
      id: '',
    },
  });

  return pathRequest.run(runOpts);
}

describe('PathRequest', () => {
  afterEach(() => {
    clearBuildCaches();
  });

  describe('should api.invalidateOnEnvChange', () => {
    it('when a resolving plugin resolves', async () => {
      const projectRoot = 'C://ProjectRoot';
      const filePath = `${projectRoot}/resolved.js`; // needs to be absolute
      const options = {
        projectRoot,
      };

      const resolverPlugins = [
        {
          name: 'resolving plugin',
          resolve: () =>
            Promise.resolve({
              filePath,
              pipeline: '',
              invalidateOnEnvChange: ['first', 'second'],
            }),
        },
      ];

      const api = setUp(resolverPlugins, options);

      await runPathRequest({
        input: {
          dependency: {
            specifier: '',
            resolveFrom: '',
          },
        },
        api,
        options,
      });

      // act
      assert(api.invalidateOnEnvChange.callCount == 2);
      assert(api.invalidateOnEnvChange.calledWith('first'));
      assert(api.invalidateOnEnvChange.calledWith('second'));
    });

    it('when no resolution and the result is excluded', async () => {
      const projectRoot = 'C://ProjectRoot';
      const options = {
        projectRoot,
      };

      const resolverPlugins = [
        {
          name: 'invalidating plugin 1',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin1'],
            }),
        },
        {
          name: 'invalidating plugin 2',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin2'],
              isExcluded: true,
            }),
        },
      ];

      const api = setUp(resolverPlugins, options);

      await runPathRequest({
        input: {
          dependency: {
            specifier: '',
            resolveFrom: '',
          },
        },
        api,
        options,
      });

      // act
      assert(api.invalidateOnEnvChange.callCount == 2);
      assert(api.invalidateOnEnvChange.calledWith('plugin1'));
      assert(api.invalidateOnEnvChange.calledWith('plugin2'));
    });

    it('when no resolution and the dependency is optional', async () => {
      const projectRoot = 'C://ProjectRoot';
      const options = {
        projectRoot,
      };

      const resolverPlugins = [
        {
          name: 'invalidating plugin 1',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin1'],
            }),
        },
        {
          name: 'invalidating plugin 2',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin2'],
            }),
        },
      ];

      const api = setUp(resolverPlugins, options);

      await runPathRequest({
        input: {
          dependency: {
            isOptional: true,
            specifier: '',
            resolveFrom: '',
          },
        },
        api,
        options,
      });

      // act
      assert(api.invalidateOnEnvChange.callCount == 2);
      assert(api.invalidateOnEnvChange.calledWith('plugin1'));
      assert(api.invalidateOnEnvChange.calledWith('plugin2'));
    });

    it('when no resolution and the dependency is not optional', async () => {
      const projectRoot = 'C://ProjectRoot';
      const options = {
        projectRoot,
      };

      const resolverPlugins = [
        {
          name: 'invalidating plugin 1',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin1'],
            }),
        },
        {
          name: 'invalidating plugin 2',
          resolve: () =>
            Promise.resolve({
              invalidateOnEnvChange: ['plugin2'],
            }),
        },
      ];

      const api = setUp(resolverPlugins, options);
      try {
        await runPathRequest({
          input: {
            dependency: {
              specifier: '',
              sourcePath: null,
            },
          },
          api,
          options,
        });
      } catch {
        //expected exception
      }

      // act
      assert(api.invalidateOnEnvChange.callCount == 2);
      assert(api.invalidateOnEnvChange.calledWith('plugin1'));
      assert(api.invalidateOnEnvChange.calledWith('plugin2'));
    });
  });
});
