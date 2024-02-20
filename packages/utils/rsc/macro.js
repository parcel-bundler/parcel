export function createBootstrapScript(url) {
  return this.addDependency({
    specifier: url,
    specifierType: 'url',
    priority: 'parallel',
    env: {
      context: 'browser',
      outputFormat: 'esmodule',
      includeNodeModules: true
    }
  });
}

export function requireClient(specifier) {
  return this.addDependency({
    specifier,
    specifierType: 'esm',
    env: {
      context: 'browser',
      outputFormat: 'esmodule',
      includeNodeModules: true
    }
  });
}

export function getClientResources(specifier) {
  // TODO: this should use a dependency id instead of a specifier so it is unique.
  return this.addDependency({
    specifier: `@parcel/rsc/resources?specifier=${encodeURIComponent(specifier)}`,
    specifierType: 'esm',
  });
}
