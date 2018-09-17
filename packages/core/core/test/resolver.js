const Resolver = require('../src/Resolver');
const path = require('path');
const assert = require('assert');
const {rimraf, ncp} = require('./utils');
const {mkdirp} = require('../src/utils/fs');
const {symlinkSync} = require('fs');

const rootDir = path.join(__dirname, 'input/resolver');

describe('resolver', function() {
  let resolver;
  before(async function() {
    await rimraf(path.join(__dirname, '/input'));
    await mkdirp(rootDir);
    await ncp(path.join(__dirname, 'integration/resolver'), rootDir);

    // Create the symlinks here to prevent cross platform and git issues
    symlinkSync(
      path.join(rootDir, 'packages/source'),
      path.join(rootDir, 'node_modules/source'),
      'dir'
    );
    symlinkSync(
      path.join(rootDir, 'packages/source-alias'),
      path.join(rootDir, 'node_modules/source-alias'),
      'dir'
    );
    symlinkSync(
      path.join(rootDir, 'packages/source-alias-glob'),
      path.join(rootDir, 'node_modules/source-alias-glob'),
      'dir'
    );

    resolver = new Resolver({
      rootDir,
      extensions: {
        '.js': true,
        '.json': true
      }
    });
  });

  describe('file paths', function() {
    it('should resolve a relative path with an extension', async function() {
      let resolved = await resolver.resolve(
        './bar.js',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve a relative path without an extension', async function() {
      let resolved = await resolver.resolve(
        './bar',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve an absolute path from the root module', async function() {
      let resolved = await resolver.resolve(
        '/bar',
        path.join(rootDir, 'nested', 'test.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve an absolute path from a node_modules folder', async function() {
      let resolved = await resolver.resolve(
        '/bar',
        path.join(rootDir, 'node_modules', 'foo', 'index.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve a tilde path from the root module', async function() {
      let resolved = await resolver.resolve(
        '~/bar',
        path.join(rootDir, 'nested', 'test.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve a tilde path from the root module without a slash', async function() {
      let resolved = await resolver.resolve(
        '~bar',
        path.join(rootDir, 'nested', 'test.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve a tilde path from a node_modules folder', async function() {
      let resolved = await resolver.resolve(
        '~/bar',
        path.join(rootDir, 'node_modules', 'foo', 'nested', 'baz.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });
  });

  describe('builtins', function() {
    it('should resolve node builtin modules', async function() {
      let resolved = await resolver.resolve(
        'zlib',
        path.join(rootDir, 'foo.js')
      );

      assert.equal(
        resolved.path,
        path.join(
          __dirname,
          '../../../..',
          'node_modules',
          'browserify-zlib',
          'lib',
          'index.js'
        )
      );
    });

    it('should resolve unimplemented node builtin modules to an empty file', async function() {
      let resolved = await resolver.resolve('fs', path.join(rootDir, 'foo.js'));
      assert.equal(
        resolved.path,
        path.join(__dirname, '..', 'src', 'builtins', '_empty.js')
      );
    });

    it('should error when resolving node builtin modules with --target=node', async function() {
      let resolver = new Resolver({
        rootDir,
        extensions: {
          '.js': true,
          '.json': true
        },
        target: 'node'
      });

      let threw = false;
      try {
        await resolver.resolve('zlib', path.join(rootDir, 'foo.js'));
      } catch (err) {
        threw = true;
      }
      assert(threw, 'did not throw');
    });
  });

  describe('node_modules', function() {
    it('should resolve a node_modules index.js', async function() {
      let resolved = await resolver.resolve(
        'foo',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'index.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });

    it('should resolve a node_modules package.main', async function() {
      let resolved = await resolver.resolve(
        'package-main',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-main', 'main.js')
      );
      assert.equal(resolved.pkg.name, 'package-main');
    });

    it('should resolve a node_modules package.module', async function() {
      let resolved = await resolver.resolve(
        'package-module',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-module', 'module.js')
      );
      assert.equal(resolved.pkg.name, 'package-module');
    });

    it('should resolve a node_modules package.browser main field', async function() {
      let resolved = await resolver.resolve(
        'package-browser',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-browser', 'browser.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser');
    });

    it('should fall back to package.main when package.module does not exist', async function() {
      let resolved = await resolver.resolve(
        'package-module-fallback',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-module-fallback', 'main.js')
      );
      assert.equal(resolved.pkg.name, 'package-module-fallback');
    });

    it('should not resolve a node_modules package.browser main field with --target=node', async function() {
      let resolver = new Resolver({
        rootDir,
        extensions: {
          '.js': true,
          '.json': true
        },
        target: 'node'
      });

      let resolved = await resolver.resolve(
        'package-browser',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-browser', 'main.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser');
    });

    it('should fall back to index.js when it cannot find package.main', async function() {
      let resolved = await resolver.resolve(
        'package-fallback',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-fallback', 'index.js')
      );
      assert.equal(resolved.pkg.name, 'package-fallback');
    });

    it('should resolve a node_module package.main pointing to a directory', async function() {
      let resolved = await resolver.resolve(
        'package-main-directory',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(
          rootDir,
          'node_modules',
          'package-main-directory',
          'nested',
          'index.js'
        )
      );
      assert.equal(resolved.pkg.name, 'package-main-directory');
    });

    it('should resolve a file inside a node_modules folder', async function() {
      let resolved = await resolver.resolve(
        'foo/nested/baz',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'nested', 'baz.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });

    it('should resolve a scoped module', async function() {
      let resolved = await resolver.resolve(
        '@scope/pkg',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.resolve(rootDir, 'node_modules/@scope/pkg/index.js')
      );
      assert.equal(resolved.pkg.name, 'scope-pkg');
    });

    it('should resolve a file inside a scoped module', async function() {
      let resolved = await resolver.resolve(
        '@scope/pkg/foo/bar',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.resolve(rootDir, 'node_modules/@scope/pkg/foo/bar.js')
      );
      assert.equal(resolved.pkg.name, 'scope-pkg');
    });
  });

  describe('aliases', function() {
    it('should alias the main file using the package.browser field', async function() {
      let resolved = await resolver.resolve(
        'package-browser-alias',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(
          rootDir,
          'node_modules',
          'package-browser-alias',
          'browser.js'
        )
      );
      assert.equal(resolved.pkg.name, 'package-browser-alias');
    });

    it('should alias a sub-file using the package.browser field', async function() {
      let resolved = await resolver.resolve(
        'package-browser-alias/foo',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-browser-alias', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser-alias');
    });

    it('should alias a relative file using the package.browser field', async function() {
      let resolved = await resolver.resolve(
        './foo',
        path.join(
          rootDir,
          'node_modules',
          'package-browser-alias',
          'browser.js'
        )
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-browser-alias', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser-alias');
    });

    it('should not alias using the package.browser field with --target=node', async function() {
      let resolver = new Resolver({
        rootDir,
        extensions: {
          '.js': true,
          '.json': true
        },
        target: 'node'
      });

      let resolved = await resolver.resolve(
        'package-browser-alias/foo',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-browser-alias', 'foo.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser-alias');
    });

    it('should alias a sub-file using the package.alias field', async function() {
      let resolved = await resolver.resolve(
        'package-alias/foo',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-alias', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'package-alias');
    });

    it('should alias a relative file using the package.alias field', async function() {
      let resolved = await resolver.resolve(
        './foo',
        path.join(rootDir, 'node_modules', 'package-alias', 'browser.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'package-alias', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'package-alias');
    });

    it('should alias a glob using the package.alias field', async function() {
      let resolved = await resolver.resolve(
        './lib/test',
        path.join(rootDir, 'node_modules', 'package-alias-glob', 'index.js')
      );
      assert.equal(
        resolved.path,
        path.join(
          rootDir,
          'node_modules',
          'package-alias-glob',
          'src',
          'test.js'
        )
      );
      assert.equal(resolved.pkg.name, 'package-alias-glob');
    });

    it('should apply a module alias using the package.alias field in the root package', async function() {
      let resolved = await resolver.resolve(
        'aliased',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'index.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });

    it('should apply a global module alias using the package.alias field in the root package', async function() {
      let resolved = await resolver.resolve(
        'aliased',
        path.join(rootDir, 'node_modules', 'package-alias', 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'index.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });

    it('should apply a global module alias to a sub-file in a package', async function() {
      let resolved = await resolver.resolve(
        'aliased/bar',
        path.join(rootDir, 'node_modules', 'package-alias', 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'foo', 'bar.js')
      );
      assert.equal(resolved.pkg.name, 'foo');
    });

    it('should apply a module alias pointing to a file using the package.alias field', async function() {
      let resolved = await resolver.resolve(
        'aliased-file',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply a global module alias pointing to a file using the package.alias field', async function() {
      let resolved = await resolver.resolve(
        'aliased-file',
        path.join(rootDir, 'node_modules', 'package-alias', 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder (relative to project dir)', async function() {
      let resolved = await resolver.resolve(
        'aliasedfolder/test.js',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'test.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder only (relative to project dir)', async function() {
      let resolved = await resolver.resolve(
        'aliasedfolder',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'index.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder (relative to root dir)', async function() {
      let resolved = await resolver.resolve(
        'aliasedabsolute/test.js',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'test.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder only (relative to root dir)', async function() {
      let resolved = await resolver.resolve(
        'aliasedabsolute',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'index.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder sub-path', async function() {
      let resolved = await resolver.resolve(
        'foo/bar',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'bar.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module folder glob sub-path', async function() {
      let resolved = await resolver.resolve(
        'glob/bar/test',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'test.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply an alias for a virtual module', async function() {
      let resolved = await resolver.resolve(
        'something',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'test.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should apply a global alias for a virtual module', async function() {
      let resolved = await resolver.resolve(
        'something',
        path.join(rootDir, 'node_modules', 'package-alias', 'foo.js')
      );
      assert.equal(resolved.path, path.join(rootDir, 'nested', 'test.js'));
      assert.equal(resolved.pkg.name, 'resolver');
    });

    it('should resolve to an empty file when package.browser resolves to false', async function() {
      let resolved = await resolver.resolve(
        'package-browser-exclude',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(__dirname, '..', 'src', 'builtins', '_empty.js')
      );
      assert.equal(resolved.pkg.name, 'package-browser-exclude');
    });

    it('should resolve to an empty file when package.alias resolves to false', async function() {
      let resolved = await resolver.resolve(
        'package-alias-exclude',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(__dirname, '..', 'src', 'builtins', '_empty.js')
      );
      assert.equal(resolved.pkg.name, 'package-alias-exclude');
    });
  });

  describe('source field', function() {
    it('should use the source field when symlinked', async function() {
      let resolved = await resolver.resolve(
        'source',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'source', 'source.js')
      );
      assert(resolved.pkg.source);
    });

    it('should not use the source field when not symlinked', async function() {
      let resolved = await resolver.resolve(
        'source-not-symlinked',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'source-not-symlinked', 'dist.js')
      );
      assert(!resolved.pkg.source);
    });

    it('should use the source field as an alias when symlinked', async function() {
      let resolved = await resolver.resolve(
        'source-alias/dist',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(rootDir, 'node_modules', 'source-alias', 'source.js')
      );
      assert(resolved.pkg.source);
    });

    it('should use the source field as a glob alias when symlinked', async function() {
      let resolved = await resolver.resolve(
        'source-alias-glob',
        path.join(rootDir, 'foo.js')
      );
      assert.equal(
        resolved.path,
        path.join(
          rootDir,
          'node_modules',
          'source-alias-glob',
          'src',
          'test.js'
        )
      );
      assert(resolved.pkg.source);
    });
  });

  describe('error handling', function() {
    it('should throw when a relative path cannot be resolved', async function() {
      let threw = false;
      try {
        await resolver.resolve('./xyz.js', path.join(rootDir, 'foo.js'));
      } catch (err) {
        threw = true;
        assert.equal(
          err.message,
          "Cannot find module './xyz.js' from '" + rootDir + "'"
        );
        assert.equal(err.code, 'MODULE_NOT_FOUND');
      }

      assert(threw, 'Did not throw');
    });

    it('should throw when a node_module cannot be resolved', async function() {
      let threw = false;
      try {
        await resolver.resolve('xyz', path.join(rootDir, 'foo.js'));
      } catch (err) {
        threw = true;
        assert.equal(
          err.message,
          "Cannot find module 'xyz' from '" + rootDir + "'"
        );
        assert.equal(err.code, 'MODULE_NOT_FOUND');
      }

      assert(threw, 'Did not throw');
    });

    it('should throw when a subfile of a node_module cannot be resolved', async function() {
      let threw = false;
      try {
        await resolver.resolve('xyz/test/file', path.join(rootDir, 'foo.js'));
      } catch (err) {
        threw = true;
        assert.equal(
          err.message,
          "Cannot find module 'xyz/test/file' from '" + rootDir + "'"
        );
        assert.equal(err.code, 'MODULE_NOT_FOUND');
      }

      assert(threw, 'Did not throw');
    });
  });
});
