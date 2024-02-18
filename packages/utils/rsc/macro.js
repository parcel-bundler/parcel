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

export function getClientReact() {
  return this.addDependency({
    specifier: './serverClient',
    specifierType: 'esm',
    priority: 'lazy',
    bundleBehavior: 'isolated',
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
  return this.addDependency({
    specifier: `@parcel/rsc/resources?specifier=${encodeURIComponent(specifier)}`,
    specifierType: 'esm',
  });
}
