// @flow
import {Resolver} from '@parcel/plugin';
import {
  isGlob,
  glob,
  globToRegex,
  relativePath,
  normalizeSeparators,
} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic from '@parcel/diagnostic';
import NodeResolver from '@parcel/node-resolver-core';
import invariant from 'assert';

function errorToThrowableDiagnostic(error, dependency): ThrowableDiagnostic {
  return new ThrowableDiagnostic({
    diagnostic: {
      message: error,
      codeFrames: dependency.loc
        ? [
            {
              codeHighlights: [
                {
                  start: dependency.loc.start,
                  end: dependency.loc.end,
                },
              ],
            },
          ]
        : undefined,
    },
  });
}

export default (new Resolver({
  async resolve({dependency, options, specifier, pipeline, logger}) {
    if (!isGlob(specifier)) {
      return;
    }

    let sourceAssetType = nullthrows(dependency.sourceAssetType);
    let sourceFile = nullthrows(
      dependency.resolveFrom ?? dependency.sourcePath,
    );

    let error;
    if (sourceAssetType !== 'js' && sourceAssetType !== 'css') {
      error = `Glob imports are not supported in ${sourceAssetType} files.`;
    } else if (
      dependency.specifierType === 'url' &&
      !dependency.meta?.isCSSImport
    ) {
      error = 'Glob imports are not supported in URL dependencies.';
    }

    if (error) {
      throw errorToThrowableDiagnostic(error, dependency);
    }

    // if the specifier does not start with /, ~, or . then it's not a path but package-ish - we resolve
    // the package first, and then append the rest of the path
    if (!/^[/~.]/.test(specifier)) {
      // Globs are not paths - so they always use / (see https://github.com/micromatch/micromatch#backslashes)
      let splitOn = specifier.indexOf('/');
      if (specifier.charAt(0) === '@') {
        splitOn = specifier.indexOf('/', splitOn + 1);
      }

      // Since we've already asserted earlier that there is a glob present, it shouldn't be
      // possible for there to be only a package here without any other path parts (e.g. `import('pkg')`)
      invariant(splitOn !== -1);

      let pkg = specifier.substring(0, splitOn);
      let rest = specifier.substring(splitOn + 1);

      // This initialisation code is copied from the DefaultResolver
      const resolver = new NodeResolver({
        fs: options.inputFS,
        projectRoot: options.projectRoot,
        // Extensions are always required in URL dependencies.
        extensions:
          dependency.specifierType === 'commonjs' ||
          dependency.specifierType === 'esm'
            ? ['ts', 'tsx', 'js', 'jsx', 'json']
            : [],
        mainFields: ['source', 'browser', 'module', 'main'],
        packageManager: options.shouldAutoInstall
          ? options.packageManager
          : undefined,
        logger,
      });

      const result = await resolver.resolve({
        filename: pkg,
        specifierType: dependency.specifierType,
        parent: dependency.resolveFrom,
        env: dependency.env,
        sourcePath: dependency.sourcePath,
        loc: dependency.loc,
      });

      if (!result || !result.filePath) {
        throw errorToThrowableDiagnostic(
          `Unable to resolve ${pkg} from ${sourceFile} when resolving specifier ${specifier}`,
          dependency,
        );
      } else if (result.diagnostics) {
        throw new ThrowableDiagnostic({diagnostic: result.diagnostics});
      }
      // We keep Flow happy by copying the filePath at a point we know it's defined
      const filePath = result.filePath;

      const ctx = {
        invalidateOnFileCreate: result.invalidateOnFileCreate || [],
        invalidateOnFileChange: new Set(result.invalidateOnFileChange),
        specifierType: dependency.specifierType,
        loc: dependency.loc,
      };

      const resolvedPackage = await resolver.findPackage(filePath, ctx);
      if (!resolvedPackage) {
        throw errorToThrowableDiagnostic(
          `Unable to find package from ${filePath} when resolving specifier ${specifier}`,
          dependency,
        );
      }
      specifier = path.resolve(resolvedPackage.pkgdir, rest);
    } else {
      specifier = path.resolve(path.dirname(sourceFile), specifier);
    }

    let normalized = normalizeSeparators(specifier);
    let files = await glob(normalized, options.inputFS, {
      onlyFiles: true,
    });

    let dir = path.dirname(specifier);
    let results = files.map(file => {
      let relative = relativePath(dir, file);
      if (pipeline) {
        relative = `${pipeline}:${relative}`;
      }

      return [file, relative];
    });

    let code = '';
    if (sourceAssetType === 'js') {
      let re = globToRegex(normalized, {capture: true});
      let matches = {};
      for (let [file, relative] of results) {
        let match = file.match(re);
        if (!match) continue;
        let parts = match
          .slice(1)
          .filter(Boolean)
          .reduce((a, p) => a.concat(p.split('/')), []);
        set(matches, parts, relative);
      }

      let {value, imports} = generate(matches, dependency.priority === 'lazy');
      code = imports + 'module.exports = ' + value;
    } else if (sourceAssetType === 'css') {
      for (let [, relative] of results) {
        code += `@import "${relative}";\n`;
      }
    }

    return {
      filePath: path.join(
        dir,
        path.basename(specifier, path.extname(specifier)) +
          '.' +
          sourceAssetType,
      ),
      code,
      invalidateOnFileCreate: [{glob: normalized}],
      pipeline: null,
      priority: 'sync',
    };
  },
}): Resolver);

function set(obj, path, value) {
  for (let i = 0; i < path.length - 1; i++) {
    let part = path[i];

    if (obj[part] == null) {
      obj[part] = {};
    }

    obj = obj[part];
  }

  obj[path[path.length - 1]] = value;
}

function generate(matches, isAsync, indent = '', count = 0) {
  if (typeof matches === 'string') {
    if (isAsync) {
      return {
        imports: '',
        value: `() => import(${JSON.stringify(matches)})`,
        count,
      };
    }

    let key = `_temp${count++}`;
    return {
      imports: `const ${key} = require(${JSON.stringify(matches)});`,
      value: key,
      count,
    };
  }

  let imports = '';
  let res = indent + '{';

  let first = true;
  for (let key in matches) {
    if (!first) {
      res += ',';
    }

    let {
      imports: i,
      value,
      count: c,
    } = generate(matches[key], isAsync, indent + '  ', count);
    imports += `${i}\n`;
    count = c;

    res += `\n${indent}  ${JSON.stringify(key)}: ${value}`;
    first = false;
  }

  res += '\n' + indent + '}';
  return {imports, value: res, count};
}
