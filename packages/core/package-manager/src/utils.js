// @flow strict-local

import type {ModuleRequest} from './types';

import invariant from 'assert';

export function npmSpecifierFromModuleRequest(
  moduleRequest: ModuleRequest,
): string {
  return moduleRequest.range != null
    ? [moduleRequest.name, moduleRequest.range].join('@')
    : moduleRequest.name;
}

export function moduleRequestsFromDependencyMap(dependencyMap: {|
  [string]: string,
|}): Array<ModuleRequest> {
  return Object.entries(dependencyMap).map(([name, range]) => {
    invariant(typeof range === 'string');
    return {
      name,
      range,
    };
  });
}
