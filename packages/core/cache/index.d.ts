import type {FilePath, Cache} from '@parcel/types';

export type {Cache} from '@parcel/types';

export const FSCache: {
  new (cacheDir: FilePath): Cache;
};

export const LMDBCache: {
  new (cacheDir: FilePath): Cache;
};
