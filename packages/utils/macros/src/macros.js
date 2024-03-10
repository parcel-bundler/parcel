// @flow

type Resource = {|
  url: string,
  type: string
|};

export function createClientEntry(url: string): Array<Resource> {
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

export function requireClient<M>(specifier: string): M {
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

export function importServerEntry<M>(specifier: string): Promise<[M, Array<Resource>]> {
  return this.addDependency({
    specifier,
    specifierType: 'esm',
    priority: 'lazy',
    meta: {
      includeResources: 'browser'
    }
  });
}
