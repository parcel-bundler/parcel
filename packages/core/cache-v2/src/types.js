// @flow
import { type Dependency } from '../../../../types';

export type CacheHash = string; // CacheHash is a combination of cacheId and filename or assetId

export type CachedAsset = {
  id: CacheHash, // Unique identifier
  type: string, // type of asset
  deps: Array<Dependency>, // Array of dependencies
  blobs: {
    key: Path // Key path combo, key becomes the extension, bin and json are preserved for buffers and objects
  }
};

export type CacheEntry = {
  id: CacheHash, // Unique identifier
  children: Array<CachedAsset>, // Array of child/sub assets that are part of the CacheEntry
  results: Array<CachedAsset> // Optional array of result assets only used in case there is a presence of a postTransform
};