// @flow strict-local

import type {FileSystem} from '@parcel/fs';
import type {EnvMap, FilePath} from '@parcel/types';

import {resolveConfig} from '@parcel/utils';
import dotenv from 'dotenv';
import variableExpansion from 'dotenv-expand';

export default async function loadEnv(
  env: EnvMap,
  fs: FileSystem,
  filePath: FilePath,
  projectRoot: FilePath,
): Promise<EnvMap> {
  const NODE_ENV = env.NODE_ENV ?? 'development';

  const dotenvFiles = [
    '.env',
    // Don't include `.env.local` for `test` environment
    // since normally you expect tests to produce the same
    // results for everyone
    NODE_ENV === 'test' ? null : '.env.local',
    `.env.${NODE_ENV}`,
    `.env.${NODE_ENV}.local`,
  ].filter(Boolean);

  let envs = await Promise.all(
    dotenvFiles.map(async dotenvFile => {
      const envPath = await resolveConfig(
        fs,
        filePath,
        [dotenvFile],
        projectRoot,
      );
      if (envPath == null) {
        return;
      }

      // `ignoreProcessEnv` prevents dotenv-expand from writing values into `process.env`:
      // https://github.com/motdotla/dotenv-expand/blob/ddb73d02322fe8522b4e05b73e1c1ad24ea7c14a/lib/main.js#L5
      let output = variableExpansion({
        parsed: dotenv.parse(await fs.readFile(envPath)),
        ignoreProcessEnv: true,
      });

      if (output.error != null) {
        throw output.error;
      }

      return output.parsed;
    }),
  );

  const packageFile = await resolveConfig(
    fs,
    filePath,
    ['package.json'],
    projectRoot,
  );

  // load npm_package_* variables from package.json (for node emulation)
  if (packageFile != null) {
    const packageJSON = await fs.readFile(packageFile, 'utf8').then(JSON.parse);

    let packageEnv = packageJSON
      .map((key, value) => {
        if (typeof value === 'string') {
          return 'npm_package_' + key.replace(/-/g, '_');
        }
      })
      .filter(Boolean);

    envs.push(packageEnv);
  }

  return Object.assign({}, ...envs);
}
