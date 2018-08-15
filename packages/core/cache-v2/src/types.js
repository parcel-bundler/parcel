// @flow
import { type Dependency } from '../../../../types';

export type CacheHash = string; // CacheHash is a combination of cacheId and filename or assetId

export type CachedAsset = {
  id: CacheHash, // Unique identifier
  code: Path, // Path to code blob
  map: Path, // Path to map blob
  type: string, // type of asset
  deps: Array<Dependency> // Array of dependencies
};

export type CacheEntry = {
  id: CacheHash, // Unique identifier
  children: Array<CachedAsset>, // Array of child/sub assets that are part of the CacheEntry
  results: Array<CachedAsset> // Optional array of result assets only used in case there is a presence of a postTransform
};