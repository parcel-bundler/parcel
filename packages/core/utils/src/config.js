// @flow

import type {ConfigResult, File, FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import path from 'path';
import clone from 'clone';

export type ConfigOutput = {|
  config: ConfigResult,
  files: Array<File>,
|};

export type ConfigOptions = {|
  parse?: boolean,
|};

const PARSERS = {
  json: require('json5').parse,
  toml: require('@iarna/toml').parse,
};

export async function resolveConfig(
  fs: FileSystem,
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions,
  root: FilePath = path.parse(filepath).root,
): Promise<FilePath | null> {
  filepath = await fs.realpath(path.dirname(filepath));

  // Don't traverse above the module root
  if (path.basename(filepath) === 'node_modules') {
    return null;
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename);
    if ((await fs.exists(file)) && (await fs.stat(file)).isFile()) {
      return file;
    }
  }

  if (filepath === root) {
    return null;
  }

  return resolveConfig(fs, filepath, filenames, opts);
}

export function resolveConfigSync(
  fs: FileSystem,
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions,
  root: FilePath = path.parse(filepath).root,
): FilePath | null {
  filepath = fs.realpathSync(path.dirname(filepath));

  // Don't traverse above the module root
  if (filepath === root || path.basename(filepath) === 'node_modules') {
    return null;
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return file;
    }
  }

  return resolveConfigSync(fs, filepath, filenames, opts);
}

export async function loadConfig(
  fs: FileSystem,
  filepath: FilePath,
  filenames: Array<FilePath>,
  opts: ?ConfigOptions,
): Promise<ConfigOutput | null> {
  let configFile = await resolveConfig(fs, filepath, filenames, opts);
  if (configFile) {
    try {
      let extname = path.extname(configFile).slice(1);
      if (extname === 'js') {
        return {
          // $FlowFixMe
          config: clone(require(configFile)),
          files: [{filePath: configFile}],
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
        files: [{filePath: configFile}],
      };
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ENOENT') {
        return null;
      }

      throw err;
    }
  }

  return null;
}
