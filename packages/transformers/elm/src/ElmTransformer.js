// @flow strict-local

import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import spawn from 'cross-spawn';
import path from 'path';
import {minify} from 'terser';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic from '@parcel/diagnostic';

let isWorker;
try {
  let worker_threads = require('worker_threads');
  isWorker = worker_threads.threadId > 0;
} catch (_) {
  isWorker = false;
}

export default (new Transformer({
  async loadConfig({config, options}) {
    const elmConfig = await config.getConfig(['elm.json']);
    if (!elmConfig) {
      await elmBinaryPath(config.searchPath, options); // Check if elm is even installed
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: "The 'elm.json' file is missing.",
          hints: [
            "Initialize your elm project by running 'elm init'",
            "If you installed elm as project dependency then run 'yarn elm init' or 'npx elm init'",
          ],
        },
      });
    }
    config.setResult(elmConfig.contents);
  },

  async transform({asset, options}) {
    const elmBinary = await elmBinaryPath(asset.filePath, options);
    const elm = await options.packageManager.require(
      'node-elm-compiler',
      asset.filePath,
      {
        shouldAutoInstall: options.shouldAutoInstall,
        saveDev: true,
      },
    );

    const compilerConfig = {
      spawn,
      cwd: path.dirname(asset.filePath),
      // $FlowFixMe[sketchy-null-string]
      debug: !options.env.PARCEL_ELM_NO_DEBUG && options.mode !== 'production',
      optimize: asset.env.shouldOptimize,
    };
    asset.invalidateOnEnvChange('PARCEL_ELM_NO_DEBUG');
    for (const filePath of await elm.findAllDependencies(asset.filePath)) {
      asset.addIncludedFile(filePath);
    }

    // Workaround for `chdir` not working in workers
    // this can be removed after https://github.com/isaacs/node-graceful-fs/pull/200 was mergend and used in parcel
    process.chdir.disabled = isWorker;

    let code = await compileToString(elm, elmBinary, asset, compilerConfig);
    if (options.hmrOptions) {
      code = await injectHotModuleReloadRuntime(code, asset.filePath, options);
    }
    if (compilerConfig.optimize) code = await minifyElmOutput(code);

    asset.type = 'js';
    asset.setCode(code);
    return [asset];
  },
}): Transformer);

async function elmBinaryPath(searchPath, options) {
  let elmBinary = await resolveLocalElmBinary(searchPath, options);

  if (elmBinary == null && !commandExists.sync('elm')) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: "Can't find 'elm' binary.",
        hints: [
          "You can add it as an dependency for your project by running 'yarn add -D elm' or 'npm add -D elm'",
          'If you want to install it globally then follow instructions on https://elm-lang.org/',
        ],
        origin: '@parcel/elm-transformer',
      },
    });
  }

  return elmBinary;
}

async function resolveLocalElmBinary(searchPath, options) {
  try {
    let result = await options.packageManager.resolve(
      'elm/package.json',
      searchPath,
      {shouldAutoInstall: false},
    );

    let bin = nullthrows(result.pkg?.bin);
    return path.join(
      path.dirname(result.resolved),
      typeof bin === 'string' ? bin : bin.elm,
    );
  } catch (_) {
    return null;
  }
}

function compileToString(elm, elmBinary, asset, config) {
  return elm.compileToString(asset.filePath, {
    pathToElm: elmBinary,
    ...config,
  });
}

async function injectHotModuleReloadRuntime(code, filePath, options) {
  const elmHMR = await options.packageManager.require('elm-hot', filePath, {
    shouldAutoInstall: options.shouldAutoInstall,
    saveDev: true,
  });
  return elmHMR.inject(code);
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

  if (result.code != null) return result.code;
  throw result.error;
}
