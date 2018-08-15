class SubModuleCacheEntry {
  constructor() {
    this.id = ''; // Id of asset
    this.deps = []; // dependencies of subModule
    this.code = ''; // Path to code result
    this.map = ''; // Path to map result
    this.type = ''; // Type of module
  }
}

class CacheEntry {
  constructor(assets, cacheId) {
    this.id = cacheId; // Id of asset
    this.subModules = assets; // Submodules of asset: SubModuleCacheEntry
  }
}