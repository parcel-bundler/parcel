// @flow

import type {Config, File, FilePath} from '@parcel/types';
import * as fs from '@parcel/fs';
import path from 'path';
import clone from 'clone';

type ConfigOutput = {|
  config: Config,
  files: Array<File>
|};

type ConfigOptions = {|
  parse?: boolean,
  noCache: boolean
|};

const PARSERS = {
  json: require('json5').parse,
  toml: require('@iarna/toml').parse
};

const existsCache = new Map();

export async function resolveConfig(
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
    let exists =
      existsCache.has(file) && (!opts || !opts.noCache)
        ? existsCache.get(file)
        : await fs.exists(file);
    if (exists) {
      existsCache.set(file, true);
      return file;
    }
  }

  return resolveConfig(filepath, filenames, opts);
}

export async function loadConfig(
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions
): Promise<ConfigOutput | null> {
  let configFile = await resolveConfig(filepath, filenames, opts);
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

      let configContent = await fs.readFile(configFile, {encoding: 'utf8'});
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
