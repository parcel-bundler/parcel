import { type Module } from '../../../../types';

export type CacheId = string; // Unique identifier to reference cache entry

export type CacheEntry = {
  id: CacheId,
  subModules: Array<Module> // Array of modules, which each reference a blob/file instead of containing code & map
};