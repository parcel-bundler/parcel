// @flow
import type {
  FilePath,
  ParcelConfig
} from '@parcel/types';
import {resolveConfig} from '@parcel/utils/lib/config';
import Config from './Config';
import fs from '@parcel/fs';
import {parse} from 'json5';
import path from 'path';
import localRequire from '@parcel/utils/localRequire';

export default class ConfigResolver {
  resolve(rootDir: FilePath): ?Config {
    let configPath = await resolveConfig(path.join(rootDir, 'index'), ['.parcelrc']);
    if (!configPath) {
      return null;
    }

    
  }

  async loadConfig(configPath: FilePath) {
    let config: ParcelConfig = parse(await fs.readFile(configPath));

    if (config.extends) {
      let extendsPath = null;
      if (config.extends.startsWith('.')) {
        extendsPath = path.resolve(configPath, config.extends);
      } else {
        extendsPath = 
      }

      let extConfig = await this.
    }
  }
}
