// @flow strict-local

import {resolveConfig} from '@parcel/utils';
import dotenv from 'dotenv';
import variableExpansion from 'dotenv-expand';

export default async function loadEnv(filePath: string): Promise<void> {
  const NODE_ENV =
    process.env.NODE_ENV == null ? 'development' : process.env.NODE_ENV;

  const dotenvFiles = [
    `.env.${NODE_ENV}.local`,
    `.env.${NODE_ENV}`,
    // Don't include `.env.local` for `test` environment
    // since normally you expect tests to produce the same
    // results for everyone
    NODE_ENV === 'test' ? null : '.env.local',
    '.env'
  ].filter(Boolean);

  await Promise.all(
    dotenvFiles.map(async dotenvFile => {
      const envPath = await resolveConfig(filePath, [dotenvFile]);
      if (envPath != null) {
        const envs = dotenv.config({path: envPath});
        variableExpansion(envs);
      }
    })
  );
}
