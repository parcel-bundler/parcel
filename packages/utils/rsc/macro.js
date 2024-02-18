export function createBootstrapScript(url: string): string[] {
  return this.addDependency({
    specifier: url,
    specifierType: 'url',
    priority: 'parallel',
    // bundleBehavior: 'isolated',
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

export function getClientResources(specifier: string) {
  return this.addDependency({
    specifier: `@parcel/rsc/resources?specifier=${encodeURIComponent(specifier)}`,
    specifierType: 'esm',
  });
}
