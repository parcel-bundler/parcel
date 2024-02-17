// @flow
export function addDependency(options) {
  return this.addDependency(options);
}

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

export function getResources() {

}
