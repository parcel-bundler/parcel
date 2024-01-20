// @flow strict-local

import {Transformer} from '@parcel/plugin';
import spawn from 'cross-spawn';
import path from 'path';
import {minify} from 'terser';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
// $FlowFixMe
import elm from 'node-elm-compiler';
// $FlowFixMe
import elmHMR from 'elm-hot';

import {load, elmBinaryPath} from './loadConfig';

let isWorker;
try {
  let worker_threads = require('worker_threads');
  isWorker = worker_threads.threadId > 0;
} catch (_) {
  isWorker = false;
}

export default (new Transformer({
  loadConfig({config}) {
    return load({config});
  },

  async transform({asset, options, logger}) {
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

    const extraSources = resolveExtraSources({asset, logger});

    extraSources.forEach(filePath => {
      asset.invalidateOnFileChange(filePath);
    });
    const sources = [asset.filePath, ...extraSources];
    const dependencies = await Promise.all(
      sources.map(source => elm.findAllDependencies(source)),
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

      if (compilerDiagnostics.type === 'compile-errors') {
        throw new ThrowableDiagnostic({
          diagnostic: compilerDiagnostics.errors.flatMap(
            elmCompileErrorToParcelDiagnostics,
          ),
        });
      }

      // compilerDiagnostics.type === "error"
      // happens for example when compiled in prod mode with Debug.log in code
      throw new ThrowableDiagnostic({
        diagnostic: formatElmError(compilerDiagnostics, ''),
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
function resolveExtraSources({asset, logger}) {
  const dirname = path.dirname(asset.filePath);
  const relativePaths = asset.query.getAll('with');

  if (relativePaths.length > 0) {
    logger.info({
      message: md`Compiling elm with additional sources: ${md.bold(
        JSON.stringify(relativePaths),
      )}`,
    });
  }

  return relativePaths.map(relPath => path.join(dirname, relPath));
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

function elmCompileErrorToParcelDiagnostics(error) {
  const relativePath = path.relative(process.cwd(), error.path);
  return error.problems.map(problem => formatElmError(problem, relativePath));
}

function formatElmError(problem, relativePath) {
  const padLength = Math.max(
    80 - 5 - problem.title.length - relativePath.length,
    1,
  );
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
}
