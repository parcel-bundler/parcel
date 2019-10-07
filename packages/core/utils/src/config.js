// @flow

import type {ConfigResult, File, FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import path from 'path';
import clone from 'clone';

type ConfigOutput = {|
  config: ConfigResult,
  files: Array<File>
|};

type ConfigOptions = {|
  parse?: boolean
|};

const PARSERS = {
  json: require('json5').parse,
  toml: require('@iarna/toml').parse
};

const existsCache = new Map();

export async function resolveConfig(
  fs: FileSystem,
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions,
  root: FilePath = path.parse(filepath).root
): Promise<FilePath | null> {
  filepath = path.dirname(filepath);

  // Don't traverse above the module root
  if (filepath === root || path.basename(filepath) === 'node_modules') {
    return null;
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename);
    if (await fs.exists(file)) {
      return file;
    }
  }

  return resolveConfig(fs, filepath, filenames, opts);
}

export async function loadConfig(
  fs: FileSystem,
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions
): Promise<ConfigOutput | null> {
  filepath = await fs.realpath(filepath);
  let configFile = await resolveConfig(fs, filepath, filenames, opts);
  if (configFile) {
    try {
      let extname = path.extname(configFile).slice(1);
      if (extname === 'js') {
        return {
          // $FlowFixMe
          config: clone(require(configFile)),
          files: [{filePath: configFile}]
        };
      }

      let configContent = await fs.readFile(configFile, 'utf8');
      if (!configContent) {
        return null;
      }

      let config;
      if (opts && opts.parse === false) {
        config = configContent;
      } else {
        let parse = PARSERS[extname] || PARSERS.json;
        config = parse(configContent);
      }

      return {
        config: config,
        files: [{filePath: configFile}]
      };
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ENOENT') {
        existsCache.delete(configFile);
        return null;
      }

      throw err;
    }
  }

  return null;
}
