// @flow
import {Resolver} from '@parcel/plugin';
import {isGlob, glob, relativePath} from '@parcel/utils';
import micromatch from 'micromatch';
import path from 'path';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default (new Resolver({
  async resolve({dependency, options, filePath, pipeline}) {
    if (!isGlob(filePath)) {
      return;
    }

    let sourceAssetType = nullthrows(dependency.sourceAssetType);
    let sourceFile = nullthrows(
      dependency.resolveFrom ?? dependency.sourcePath,
    );

    let error;
    if (sourceAssetType !== 'js' && sourceAssetType !== 'css') {
      error = `Glob imports are not supported in ${sourceAssetType} files.`;
    } else if (dependency.isURL) {
      error = 'Glob imports are not supported in URL dependencies.';
    }

    if (error) {
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: error,
          filePath: sourceFile,
          codeFrame: dependency.loc
            ? {
                codeHighlights: [
                  {start: dependency.loc.start, end: dependency.loc.end},
                ],
                code: await options.inputFS.readFile(sourceFile, 'utf8'),
              }
            : undefined,
        },
      });
    }

    filePath = path.resolve(path.dirname(sourceFile), filePath);
    let files = await glob(
      path.resolve(path.dirname(sourceFile), filePath),
      options.inputFS,
      {
        onlyFiles: true,
      },
    );

    let dir = path.dirname(filePath);
    let results = files.map(file => {
      let relative = relativePath(dir, file);
      if (pipeline) {
        relative = `${pipeline}:${relative}`;
      }

      return [file, relative];
    });

    let code = '';
    if (sourceAssetType === 'js') {
      let re = micromatch.makeRe(filePath, {capture: true});
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

      code = 'module.exports = ' + generate(matches, dependency.isAsync);
    } else if (sourceAssetType === 'css') {
      for (let [, relative] of results) {
        code += `@import "${relative}";\n`;
      }
    }

    return {
      filePath: path.join(
        dir,
        path.basename(filePath, path.extname(filePath)) + '.' + sourceAssetType,
      ),
      code,
      invalidateOnFileCreate: [{glob: filePath}],
      pipeline: null,
      isAsync: false,
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

function generate(matches, isAsync, indent = '') {
  if (typeof matches === 'string') {
    return isAsync
      ? `() => import(${JSON.stringify(matches)})`
      : `require(${JSON.stringify(matches)})`;
  }

  let res = indent + '{';

  let first = true;
  for (let key in matches) {
    if (!first) {
      res += ',';
    }

    res += `\n${indent}  ${JSON.stringify(key)}: ${generate(
      matches[key],
      isAsync,
      indent + '  ',
    )}`;
    first = false;
  }

  res += '\n' + indent + '}';
  return res;
}
