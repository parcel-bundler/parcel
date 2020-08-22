// @flow
import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import path from 'path';
import fs from 'fs';
import spawn from 'cross-spawn';
import elm from 'node-elm-compiler';
import {inject as injectElmHMR} from 'elm-hot';
import {minify} from 'terser';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default new Transformer({
  async transform({asset, options}) {
    const config = {
      cwd: path.dirname(asset.filePath),
      debug: !(
        options.env.PARCEL_ELM_NO_DEBUG || options.mode === 'production'
      ),
      optimize: asset.env.minify,
    };

    (await elm.findAllDependencies(asset.filePath)).forEach(filePath =>
      asset.addIncludedFile({filePath}),
    );

    let code = await compileToString(asset, options, config);
    if (options.hot) code = injectElmHMR(code);
    if (config.optimize) code = await minifyElmOutput(code);

    asset.type = '.js';
    asset.setCode(code);
    return [asset];
  },
});

async function compileToString(asset, options, config) {
  const installPackage = name => {
    if (!options.autoinstall) {
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: `Denpendency '${name}' is not installed and autoinstall is turned off. Either install dependency manually or enable autoinstall`,
          origin: '@parcel/package-manager',
        },
      });
    }

    return options.packageManager.resolve(name, asset.filePath);
  };
  const pathToElmBin = await pathToElm(options.projectRoot, installPackage);
  await ensureElmJson(asset, pathToElmBin);

  const compileOptions = {
    cwd: config.cwd,
    debug: config.debug,
    optimize: config.optimize,
    pathToElm: pathToElmBin,
  };
  return elm.compileToString(asset.filePath, compileOptions);
}

async function pathToElm(root, installPackage) {
  if (!commandExists.sync('elm')) {
    const elmBin = path.resolve(root, 'node_modules/elm/bin/elm');

    if (!fs.existsSync(elmBin)) await installPackage('elm');
    return elmBin;
  }

  return undefined; // use globally installed elm
}

async function ensureElmJson(asset, pathToElmBin) {
  const elmJson = await asset.getConfig(['elm.json'], {parse: false});
  if (!elmJson) {
    createElmJson(pathToElmBin);
    // Watch the new elm.json for changes
    await asset.getConfig(['elm.json'], {parse: false});
  }
}

function createElmJson(pathToElmBin) {
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

async function minifyElmOutput(source) {
  // Recommended minification
  // Based on: http://elm-lang.org/0.19.0/optimize
  let result = await minify(source, {
    compress: {
      keep_fargs: false,
      passes: 2,
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
      unsafe: true,
      unsafe_comps: true,
    },
    mangle: true,
  });

  if (result.code) return result.code;
  throw result.error;
}
