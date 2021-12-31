// @flow
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import {relativeUrl} from '@parcel/utils';
import {compile, preprocess} from 'svelte/compiler';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default (new Transformer({
  async loadConfig({config, options, logger}) {
    const svelteConfig = await config.getConfig([
      '.svelterc',
      '.svelterc.json',
      'svelte.config.js',
    ]);
    if (!svelteConfig) return {};
    if (svelteConfig.filePath.endsWith('.js')) {
      // TODO: Is there a better way of handling this warning? Probably just
      // mention it in the documentation and silently invalidate.
      logger.warn({
        message:
          'WARNING: Using a JavaScript Svelte config file means losing ' +
          'out on caching features of Parcel. Use a .svelterc(.json) ' +
          'file whenever possible.',
      });
      config.invalidateOnStartup();
    }
    return {
      ...svelteConfig.contents,
      compilerOptions: {
        css: false,
        ...svelteConfig.contents.compilerOptions,
        dev: options.mode !== 'production',
      },
    };
  },

  async transform({
    asset,
    config: {preprocess: preprocessConf, compilerOptions},
    options,
    logger,
  }) {
    let source = await asset.getCode();
    const filename = relativeUrl(options.projectRoot, asset.filePath);

    // If the preprocessor config is never defined in the svelte config, attempt
    // to import `svelte-preprocess`. If that is importable, use that to
    // preprocess the file. Otherwise, do not run any preprocessors.
    if (preprocessConf === undefined) {
      let preprocessor = null;
      logger.verbose({
        message:
          'No preprocess specified; attempting to use `svelte-preprocess`.',
      });
      try {
        preprocessor = require('svelte-preprocess');
      } catch (e) {
        logger.verbose({
          message:
            'Unable to import `svelte-preprocess`; not running any preprocessor.',
        });
      }
      if (preprocessor) {
        preprocessConf = preprocessor();
      }
    }

    // Only preprocess if there is a config for it.
    if (preprocessConf) {
      logger.verbose({message: 'Preprocessing svelte file.'});
      const processed = await catchDiag(
        async () =>
          await preprocess(source, preprocessConf, {
            filename,
          }),
        source,
      );
      source = processed.code;
    }

    logger.verbose({message: 'Compiling svelte file.'});
    const compiled = await catchDiag(
      async () =>
        await compile(source, {
          ...compilerOptions,
          filename,
        }),
      source,
    );

    // Create the new assets from the compilation result.
    const assets = [
      {
        type: 'js',
        content: compiled.js.code,
        uniqueKey: `${asset.id}-js`,
        map: extractSourceMaps(asset, compiled.js.map),
      },
    ];
    if (compiled.css && compiled.css.code) {
      assets.push({
        type: 'css',
        content: compiled.css.code,
        uniqueKey: `${asset.id}-css`,
        map: extractSourceMaps(asset, compiled.css.map),
      });
    }

    // Forward any warnings from the svelte compiler to the parcel diagnostics.
    if (compiled.warnings.length > 0) {
      for (const warning of compiled.warnings) {
        logger.warn(convertDiag(warning));
      }
    }

    return assets;
  },
}): Transformer);

function extractSourceMaps(asset, sourceMap) {
  if (!sourceMap) return;
  sourceMap.sources = [asset.filePath];
  const map = new SourceMap();
  map.addVLQMap(sourceMap);
  return map;
}

async function catchDiag(fn, code) {
  try {
    return await fn();
  } catch (e) {
    throw new ThrowableDiagnostic({
      diagnostic: convertDiag(e, code),
    });
  }
}

function convertDiag(svelteDiag, code) {
  const codeFrame = {
    filePath: svelteDiag.filename,
    code,
    codeHighlights: [
      {
        start: svelteDiag.start,
        end: svelteDiag.end,
      },
    ],
  };
  return {
    message: svelteDiag.message,
    codeFrames: [codeFrame],
  };
}
