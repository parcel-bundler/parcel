// @flow
import type {FileSystem} from '@parcel/fs';
import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import path from 'path';

export function detectSVGOVersion(
  config: any,
): {|version: 3|} | {|version: 2, path: string|} {
  if (!config) {
    return {version: 3};
  }

  // These options were removed in v2.
  if (config.full != null || config.svg2js != null) {
    return {version: 2, path: config.full != null ? '/full' : '/svg2js'};
  }

  if (Array.isArray(config.plugins)) {
    // Custom plugins in v2 had additional (required) fields that don't exist anymore.
    let v2Plugin = config.plugins.findIndex(
      p => p?.type != null || (p?.fn && p?.params != null),
    );
    if (v2Plugin !== -1) {
      let field = config.plugins[v2Plugin].type != null ? 'type' : 'params';
      return {version: 2, path: `/plugins/${v2Plugin}/${field}`};
    }

    // the cleanupIDs plugin lost the prefix option in v3.
    let cleanupIdsIndex = config.plugins.findIndex(
      p => p?.name === 'cleanupIDs',
    );
    let cleanupIDs =
      cleanupIdsIndex !== -1 ? config.plugins[cleanupIdsIndex] : null;
    if (cleanupIDs?.params?.prefix != null) {
      return {version: 2, path: `/plugins/${cleanupIdsIndex}/params/prefix`};
    }

    // Automatically migrate some options from SVGO 2 config files.
    config.plugins = config.plugins.filter(p => p?.active !== false);

    for (let i = 0; i < config.plugins.length; i++) {
      let p = config.plugins[i];
      if (p === 'cleanupIDs') {
        config.plugins[i] = 'cleanupIds';
      }

      if (p?.name === 'cleanupIDs') {
        config.plugins[i].name = 'cleanupIds';
      }
    }
  }

  return {version: 3};
}

export async function convertSVGOConfig(
  config: any,
  filePath: string,
  jsonPath: string,
  fs: FileSystem,
  hint?: string,
): Promise<any> {
  if (typeof config === 'boolean') {
    return {default: config};
  }

  if (!config || typeof config !== 'object') {
    return {default: true};
  }

  let result = {
    default: false,
  };

  if (Array.isArray(config.plugins)) {
    for (let [i, plugin] of config.plugins.entries()) {
      let name: string,
        params = true;
      if (typeof plugin === 'string') {
        name = plugin;
      } else if (
        typeof plugin === 'object' &&
        typeof plugin?.name === 'string'
      ) {
        name = plugin.name;
        params = plugin.params ?? true;

        if (typeof plugin.fn === 'function') {
          await throwDiagnostic(
            'Unsupported custom SVGO plugin.',
            filePath,
            `${jsonPath}/plugins/${i}/fn`,
            fs,
            hint,
          );
        }
      } else if (typeof plugin === 'function') {
        await throwDiagnostic(
          'Unsupported custom SVGO plugin.',
          filePath,
          `${jsonPath}/plugins/${i}`,
          fs,
          hint,
        );
      } else {
        continue;
      }

      if (name === 'cleanupIDs') {
        name = 'cleanupIds';
      }

      if (name === 'preset-default') {
        result.default = true;
        if (
          typeof params === 'object' &&
          typeof params?.overrides === 'object' &&
          params.overrides
        ) {
          for (let key in params.overrides) {
            result[key] = params.overrides[key];
          }
        }
      } else if (typeof name === 'string') {
        result[(name: any)] = params || false;
      }
    }
  }

  return result;
}

async function throwDiagnostic(message, filePath, jsonPath, fs, hint) {
  throw new ThrowableDiagnostic({
    diagnostic: {
      message: message,
      codeFrames: [
        {
          filePath: filePath,
          codeHighlights:
            path.extname(filePath) === '' || path.extname(filePath) === '.json'
              ? generateJSONCodeHighlights(
                  await fs.readFile(filePath, 'utf8'),
                  [
                    {
                      key: jsonPath,
                    },
                  ],
                )
              : [],
        },
      ],
      hints: hint ? [hint] : [],
    },
  });
}
