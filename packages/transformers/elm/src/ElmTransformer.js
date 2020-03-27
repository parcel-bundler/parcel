// @flow

import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import path from 'path';
import spawn from 'cross-spawn';
import elm from 'node-elm-compiler';
import {inject as injectElmHMR} from 'elm-hot';
import {minify} from 'terser';

export default new Transformer({
  async getConfig({asset, options}) {
    const localResolve = moduleName =>
      options.packageManager.resolve(moduleName, asset.filePath, {
        autoInstall: options.autoinstall,
      });

    const pathToElmBin = await pathToElm(localResolve);
    await ensureElmJson(asset, pathToElmBin);

    return {
      cwd: path.dirname(asset.filePath),
      debug: !(options.env.PARCE_ELM_NO_DEBUG || options.mode === 'production'),
      optimize: asset.env.minify,
      pathToElm: pathToElmBin,
    };
  },

  async transform({asset, config, options}) {
    (await elm.findAllDependencies(asset.filePath)).forEach(filePath =>
      asset.addIncludedFile({filePath}),
    );

    let code = await elm.compileToString(asset.filePath, config);
    if (options.hot) code = injectElmHMR(code);
    if (config.optimize) code = minifyElmOutput(code);

    return [
      {
        type: 'js',
        dependencies: '',
        code,
      },
    ];
  },
});

async function pathToElm(localResolve, pathResolve) {
  return !commandExists('elm')
    ? pathResolve(await localResolve('elm'), 'bin/elm')
    : undefined;
}

async function ensureElmJson(asset, pathToElmBin) {
  const elmJson = await asset.getConfig(['elm.json'], {parse: false});
  if (!elmJson) {
    createElmJson(pathToElmBin);
    // Watch the new elm.json for changes
    await asset.getConfig(['elm.json'], {parse: false});
  }
}

async function createElmJson(pathToElmBin) {
  let elmProc = spawn(pathToElmBin || 'elm', ['init']);
  elmProc.stdin.write('y\n');

  return new Promise((resolve, reject) => {
    elmProc.on('error', reject);
    elmProc.on('close', function(code) {
      if (code !== 0) reject(new Error('elm init failed.'));
      else resolve();
    });
  });
}

function minifyElmOutput(source) {
  // Recommended minification
  // Based on: http://elm-lang.org/0.19.0/optimize
  let result = minify(source, {
    compress: {
      pure_funcs: [
        'F2',
        'F3',
        'F4',
        'F5',
        'F6',
        'F7',
        'F8',
        'F9',
        'A2',
        'A3',
        'A4',
        'A5',
        'A6',
        'A7',
        'A8',
        'A9',
      ],
      pure_getters: true,
      keep_fargs: false,
      unsafe_comps: true,
      unsafe: true,
    },
  });

  if (result.error) throw result.error;
  result = minify(result.code, {mangle: true});

  if (result.error) throw result.error;
  return result.code;
}
