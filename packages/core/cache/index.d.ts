import type {FilePath} from '@parcel/types';
import type {Cache} from './lib/types';

export type {Cache} from './lib/types';
export const FSCache: {
  new (cacheDir: FilePath): Cache
};

export const LMDBCache: {
  new (cacheDir: FilePath): Cache
};
