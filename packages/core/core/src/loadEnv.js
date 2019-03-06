import {resolveConfig} from '@parcel/utils/src/config';
import dotenv from 'dotenv';
import variableExpansion from 'dotenv-expand';

export default async function loadEnv(filepath) {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const dotenvFiles = [
    `.env.${NODE_ENV}.local`,
    `.env.${NODE_ENV}`,
    // Don't include `.env.local` for `test` environment
    // since normally you expect tests to produce the same
    // results for everyone
    NODE_ENV !== 'test' && '.env.local',
    '.env'
  ].filter(Boolean);

  await Promise.all(
    dotenvFiles.map(async dotenvFile => {
      const envPath = await resolveConfig(filepath, [dotenvFile]);
      if (envPath) {
        const envs = dotenv.config({path: envPath});
        variableExpansion(envs);
      }
    })
  );
}
