// @flow strict-local

import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import spawn from 'cross-spawn';
import path from 'path';
import {minify} from 'terser';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
// $FlowFixMe
import elm from 'node-elm-compiler';
// $FlowFixMe
import elmHMR from 'elm-hot';

let isWorker;
try {
  let worker_threads = require('worker_threads');
  isWorker = worker_threads.threadId > 0;
} catch (_) {
  isWorker = false;
}

export default (new Transformer({
  async loadConfig({config}) {
    const elmConfig = await config.getConfig(['elm.json']);
    if (!elmConfig) {
      elmBinaryPath(); // Check if elm is even installed
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
    return elmConfig.contents;
  },

  async transform({asset, options}) {
    const elmBinary = elmBinaryPath();
    const compilerConfig = {
      spawn,
      cwd: path.dirname(asset.filePath),
      // $FlowFixMe[sketchy-null-string]
      debug: !options.env.PARCEL_ELM_NO_DEBUG && options.mode !== 'production',
      optimize: asset.env.shouldOptimize,
      report: 'json',
    };
    asset.invalidateOnEnvChange('PARCEL_ELM_NO_DEBUG');

    const dirname = path.dirname(asset.filePath);
    const extraSources = resolveExtraSources(asset);

    extraSources.forEach(filePath => {
      asset.invalidateOnFileChange(filePath);
    });
    const sources = [asset.filePath, ...extraSources];
    const dependencies = await Promise.all(
      sources.map(elm.findAllDependencies),
    );
    const uniqueDeps = new Set(dependencies.flat());
    Array.from(uniqueDeps).forEach(filePath => {
      asset.invalidateOnFileChange(filePath);
    });

    // Workaround for `chdir` not working in workers
    // this can be removed after https://github.com/isaacs/node-graceful-fs/pull/200 was mergend and used in parcel
    // $FlowFixMe[method-unbinding]
    process.chdir.disabled = isWorker;
    let code;
    try {
      code = await compileToString(elm, elmBinary, sources, compilerConfig);
    } catch (e) {
      let compilerJson = e.message.split('\n')[1];
      let compilerDiagnostics = JSON.parse(compilerJson);

      throw new ThrowableDiagnostic({
        diagnostic: compilerDiagnostics.errors.flatMap(
          elmErrorToParcelDiagnostics,
        ),
      });
    }

    if (options.hmrOptions) {
      code = elmHMR.inject(code);
    }
    if (compilerConfig.optimize) code = await minifyElmOutput(code);

    asset.type = 'js';
    asset.setCode(code);
    return [asset];
  },
}): Transformer);

// gather extra modules that should be added to the compilation process
function resolveExtraSources(asset) {
  const withParam = asset.query.get('with');
  if (withParam === null) {
    return [];
  }
  const dirname = path.dirname(asset.filePath);
  return withParam.split(',').map(relPath => path.join(dirname, relPath));
}

function elmBinaryPath() {
  let elmBinary = resolveLocalElmBinary();

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

function resolveLocalElmBinary() {
  try {
    let result = require.resolve('elm/package.json');
    // $FlowFixMe
    let pkg = require('elm/package.json');
    let bin = nullthrows(pkg.bin);
    return path.join(
      path.dirname(result),
      typeof bin === 'string' ? bin : bin.elm,
    );
  } catch (_) {
    return null;
  }
}

function compileToString(elm, elmBinary, sources, config) {
  return elm.compileToString(sources, {
    pathToElm: elmBinary,
    ...config,
  });
}

let elmPureFuncs = [
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
];

async function minifyElmOutput(source) {
  // Recommended minification
  // Based on: http://elm-lang.org/0.19.0/optimize
  let result = await minify(source, {
    compress: {
      keep_fargs: false,
      passes: 2,
      pure_funcs: elmPureFuncs,
      pure_getters: true,
      unsafe: true,
      unsafe_comps: true,
    },
    mangle: {
      reserved: elmPureFuncs,
    },
  });

  if (result.code != null) return result.code;
  throw result.error;
}

function formatMessagePiece(piece) {
  if (piece.string) {
    if (piece.underline) {
      return md`${md.underline(piece.string)}`;
    }
    return md`${md.bold(piece.string)}`;
  }
  return md`${piece}`;
}

function elmErrorToParcelDiagnostics(error) {
  const relativePath = path.relative(process.cwd(), error.path);
  return error.problems.map(problem => {
    const padLength = 80 - 5 - problem.title.length - relativePath.length;
    const dashes = '-'.repeat(padLength);
    const message = [
      '',
      `-- ${problem.title} ${dashes} ${relativePath}`,
      '',
      problem.message.map(formatMessagePiece).join(''),
    ].join('\n');

    return {
      message,
      origin: '@parcel/elm-transformer',
      stack: '', // set stack to empty since it is not useful
    };
  });
}
