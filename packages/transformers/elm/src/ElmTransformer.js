// @flow

import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import path from 'path';
import spawn from 'cross-spawn';
import elm from 'node-elm-compiler';
import {inject as injectElmHMR} from 'elm-hot';
import {minify} from 'terser';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default (new Transformer({
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
}): Transformer);

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

    return options.packageManager.resolve(name, asset.filePath, {
      autoinstall: true,
    });
  };
  await ensureElmIsInstalled(installPackage);
  await ensureElmJson(asset);

  const compileOptions = {
    cwd: config.cwd,
    debug: config.debug,
    optimize: config.optimize,
  };
  return elm.compileToString(asset.filePath, compileOptions);
}

async function ensureElmIsInstalled(installPackage) {
  if (!commandExists.sync('elm')) {
    await installPackage('elm/package.json');
    if (!commandExists.sync('elm')) {
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: `Can't find 'elm' after autoinstall.`,
          origin: '@parcel/elm-transformer',
        },
      });
    }
  }
}

async function ensureElmJson(asset) {
  const elmJson = await asset.getConfig(['elm.json'], {parse: false});
  if (!elmJson) {
    createElmJson();
    // Watch the new elm.json for changes
    await asset.getConfig(['elm.json'], {parse: false});
  }
}

function createElmJson() {
  let elmProc = spawn('elm', ['init']);
  return new Promise((resolve, reject) => {
    elmProc.on('error', reject);
    elmProc.on('close', function(code) {
      if (code !== 0) reject(new Error('elm init failed.'));
      else resolve();
    });
    elmProc.stdin.write('y\n');
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
