// @flow
import ConfigResolver from '../src/ConfigResolver';
import assert from 'assert';
import path from 'path';
import Config from '../src/ParcelConfig';

describe('ConfigResolver', () => {
  let resolver = new ConfigResolver();

  describe('validatePackageName', () => {
    it('should error on an invalid official package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          '@parcel/foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Official parcel transform packages must be named according to "@parcel\/transform-{name}" but got "@parcel\/foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid official package', () => {
      resolver.validatePackageName(
        '@parcel/transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });

    it('should error on an invalid community package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          'foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Parcel transform packages must be named according to "parcel-transform-{name}" but got "foo-bar" in .parcelrc./);

      assert.throws(() => {
        resolver.validatePackageName(
          'parcel-foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Parcel transform packages must be named according to "parcel-transform-{name}" but got "parcel-foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid community package', () => {
      resolver.validatePackageName(
        'parcel-transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });

    it('should error on an invalid scoped package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          '@test/foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform-{name}" but got "@test\/foo-bar" in .parcelrc./);

      assert.throws(() => {
        resolver.validatePackageName(
          '@test/parcel-foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform-{name}" but got "@test\/parcel-foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid scoped package', () => {
      resolver.validatePackageName(
        '@test/parcel-transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });
  });

  describe('validatePipeline', () => {
    it('should require pipeline to be an array', () => {
      assert.throws(() => {
        // $FlowFixMe
        resolver.validatePipeline('123', 'resolver', 'resolvers', '.parcelrc');
      }, /"resolvers" must be an array in .parcelrc/);
    });

    it('should require pipeline elements to be strings', () => {
      assert.throws(() => {
        resolver.validatePipeline(
          // $FlowFixMe
          [1, 'foo', 3],
          'resolver',
          'resolvers',
          '.parcelrc'
        );
      }, /"resolvers" elements must be strings in .parcelrc/);
    });

    it('should require package names to be valid', () => {
      assert.throws(() => {
        resolver.validatePipeline(
          ['parcel-foo-bar'],
          'resolver',
          'resolvers',
          '.parcelrc'
        );
      }, /Parcel resolver packages must be named according to "parcel-resolver-{name}" but got "parcel-foo-bar" in .parcelrc./);
    });

    it('should succeed with an array of valid package names', () => {
      resolver.validatePipeline(
        ['parcel-resolver-test'],
        'resolver',
        'resolvers',
        '.parcelrc'
      );
    });

    it('should support spread elements', () => {
      resolver.validatePipeline(
        ['parcel-resolver-test', '...'],
        'resolver',
        'resolvers',
        '.parcelrc'
      );
    });
  });

  describe('validateMap', () => {
    it('should require glob map to be an object', () => {
      assert.throws(() => {
        resolver.validateMap(
          // $FlowFixMe
          'foo',
          () => {},
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /"transforms" must be an object in .parcelrc/);
    });

    it('should trigger the validator function for each key', () => {
      assert.throws(() => {
        resolver.validateMap(
          {
            '*.js': ['foo']
          },
          resolver.validatePipeline.bind(resolver),
          'transform',
          'transforms',
          '.parcelrc'
        );
      });

      resolver.validateMap(
        {
          '*.js': ['parcel-transform-foo']
        },
        resolver.validatePipeline.bind(resolver),
        'transform',
        'transforms',
        '.parcelrc'
      );
    });
  });

  describe('validateExtends', () => {
    it('should require extends to be a string or array of strings', () => {
      assert.throws(() => {
        // $FlowFixMe
        resolver.validateExtends(2, '.parcelrc');
      }, /"extends" must be a string or array of strings in .parcelrc/);

      assert.throws(() => {
        // $FlowFixMe
        resolver.validateExtends([2, 4], '.parcelrc');
      }, /"extends" elements must be strings in .parcelrc/);
    });

    it('should support relative paths', () => {
      resolver.validateExtends('./foo', '.parcelrc');
      resolver.validateExtends(['./foo', './bar'], '.parcelrc');
    });

    it('should validate package names', () => {
      assert.throws(() => {
        resolver.validateExtends('foo', '.parcelrc');
      });

      assert.throws(() => {
        resolver.validateExtends(['foo', 'bar'], '.parcelrc');
      });

      resolver.validateExtends('parcel-config-foo', '.parcelrc');
      resolver.validateExtends(
        ['parcel-config-foo', 'parcel-config-bar'],
        '.parcelrc'
      );
    });
  });

  describe('validateConfig', () => {
    it('should throw on invalid config', () => {
      assert.throws(() => {
        resolver.validateConfig(
          {
            filePath: '.parcelrc',
            extends: 'parcel-config-foo',
            transforms: {
              '*.js': ['parcel-invalid-plugin']
            }
          },
          '.parcelrc'
        );
      });
    });

    it('should succeed on valid config', () => {
      resolver.validateConfig(
        {
          filePath: '.parcelrc',
          extends: 'parcel-config-foo',
          transforms: {
            '*.js': ['parcel-transformer-foo']
          }
        },
        '.parcelrc'
      );
    });
  });

  describe('mergePipelines', () => {
    it('should return an empty array if base and extension are null', () => {
      assert.deepEqual(resolver.mergePipelines(null, null), []);
    });

    it('should return base if extension is null', () => {
      assert.deepEqual(
        resolver.mergePipelines(['parcel-transform-foo'], null),
        ['parcel-transform-foo']
      );
    });

    it('should return extension if base is null', () => {
      assert.deepEqual(
        resolver.mergePipelines(null, ['parcel-transform-bar']),
        ['parcel-transform-bar']
      );
    });

    it('should return extension if there are no spread elements', () => {
      assert.deepEqual(
        resolver.mergePipelines(
          ['parcel-transform-foo'],
          ['parcel-transform-bar']
        ),
        ['parcel-transform-bar']
      );
    });

    it('should return merge base into extension if there are spread elements', () => {
      assert.deepEqual(
        resolver.mergePipelines(
          ['parcel-transform-foo'],
          ['parcel-transform-bar', '...', 'parcel-transform-baz']
        ),
        ['parcel-transform-bar', 'parcel-transform-foo', 'parcel-transform-baz']
      );
    });

    it('should throw if more than one spread element is in a pipeline', () => {
      assert.throws(() => {
        resolver.mergePipelines(
          ['parcel-transform-foo'],
          ['parcel-transform-bar', '...', 'parcel-transform-baz', '...']
        );
      }, /Only one spread element can be included in a config pipeline/);
    });
  });

  describe('mergeMaps', () => {
    it('should return an empty object if base and extension are null', () => {
      assert.deepEqual(resolver.mergeMaps(null, null), {});
    });

    it('should return base if extension is null', () => {
      assert.deepEqual(resolver.mergeMaps({'*.js': 'foo'}, null), {
        '*.js': 'foo'
      });
    });

    it('should return extension if base is null', () => {
      assert.deepEqual(resolver.mergeMaps(null, {'*.js': 'foo'}), {
        '*.js': 'foo'
      });
    });

    it('should merge the objects', () => {
      assert.deepEqual(
        resolver.mergeMaps(
          {'*.css': 'css', '*.js': 'base-js'},
          {'*.js': 'ext-js'}
        ),
        {'*.js': 'ext-js', '*.css': 'css'}
      );
    });

    it('should ensure that extension properties have a higher precidence than base properties', () => {
      assert.deepEqual(
        resolver.mergeMaps({'*.{js,jsx}': 'base-js'}, {'*.js': 'ext-js'}),
        {'*.js': 'ext-js', '*.{js,jsx}': 'base-js'}
      );
      assert.deepEqual(
        Object.keys(
          resolver.mergeMaps({'*.{js,jsx}': 'base-js'}, {'*.js': 'ext-js'})
        ),
        ['*.js', '*.{js,jsx}']
      );
    });

    it('should call a merger function if provided', () => {
      let merger = (a, b) => [a, b];
      assert.deepEqual(
        resolver.mergeMaps({'*.js': 'base-js'}, {'*.js': 'ext-js'}, merger),
        {'*.js': ['base-js', 'ext-js']}
      );
    });
  });

  describe('mergeConfigs', () => {
    it('should merge configs', () => {
      let base = {
        filePath: '.parcelrc',
        resolvers: ['parcel-resolver-base'],
        transforms: {
          '*.js': ['parcel-transform-base'],
          '*.css': ['parcel-transform-css']
        },
        bundler: 'parcel-bundler-base'
      };

      let ext = {
        filePath: '.parcelrc',
        resolvers: ['parcel-resolver-ext', '...'],
        transforms: {
          '*.js': ['parcel-transform-ext', '...']
        }
      };

      let merged = {
        filePath: '.parcelrc',
        resolvers: ['parcel-resolver-ext', 'parcel-resolver-base'],
        transforms: {
          '*.js': ['parcel-transform-ext', 'parcel-transform-base'],
          '*.css': ['parcel-transform-css']
        },
        bundler: 'parcel-bundler-base',
        runtimes: {},
        namers: [],
        optimizers: {},
        packagers: {},
        reporters: []
      };

      assert.deepEqual(resolver.mergeConfigs(base, ext), merged);
    });
  });

  describe('resolveExtends', () => {
    it('should resolve a relative path', async () => {
      let resolved = await resolver.resolveExtends(
        '../.parcelrc',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.parcelrc')
      );
      assert.equal(
        resolved,
        path.join(__dirname, 'fixtures', 'config', '.parcelrc')
      );
    });

    it('should resolve a package name', async () => {
      let resolved = await resolver.resolveExtends(
        '@parcel/config-default',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.parcelrc')
      );
      assert.equal(resolved, require.resolve('@parcel/config-default'));
    });
  });

  describe('loadConfig', () => {
    it('should load and merge configs', async () => {
      let defaultConfig = require('@parcel/config-default');
      // $FlowFixMe
      let resolved = await resolver.loadConfig(
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.parcelrc'),
        __dirname
      );

      assert.deepEqual(resolved.transforms['*.js'], [
        'parcel-transformer-sub',
        'parcel-transformer-base',
        '...'
      ]);
      assert(Object.keys(resolved.transforms).length > 1);
      assert.deepEqual(resolved.resolvers, defaultConfig.resolvers);
      assert.deepEqual(resolved.bundler, defaultConfig.bundler);
      assert.deepEqual(resolved.namers, defaultConfig.namers || []);
      assert.deepEqual(resolved.packagers, defaultConfig.packagers || {});
      assert.deepEqual(resolved.optimizers, defaultConfig.optimizers || {});
      assert.deepEqual(resolved.reporters, defaultConfig.reporters || []);
    });
  });

  describe('resolve', () => {
    it('should return null if there is no .parcelrc file found', async () => {
      let resolved = await resolver.resolve(__dirname);
      assert.equal(resolved, null);
    });

    it('should resolve a config if a .parcelrc file is found', async () => {
      let resolved = await resolver.resolve(
        path.join(__dirname, 'fixtures', 'config', 'subfolder')
      );
      assert(resolved instanceof Config);
    });
  });
});
