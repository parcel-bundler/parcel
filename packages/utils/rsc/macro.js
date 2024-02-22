import { JsExpression } from '@parcel/rust';

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

export function importServerComponent(specifier) {
  let componentDep = this.addDependency({
    specifier,
    specifierType: 'esm',
    priority: 'lazy'
  });

  let resourcesDep = this.addDependency({
    specifier: `@parcel/runtime-rsc/resources?id=${encodeURIComponent(componentDep.id)}`,
    specifierType: 'esm',
  });

  return new JsExpression(`Promise.all([${componentDep}, ${resourcesDep}])`)
}
