import React, {FC} from 'react';

let loaderMap = new WeakMap<DeferredImport<any>, Promise<any>>();
let componentMap = new WeakMap<DeferredImport<any>, any>();

export function deferredLoadComponent<T>(
  resource: DeferredImport<T extends {default: any} ? T : never>,
): FC {
  if (!loaderMap.has(resource)) {
    loaderMap.set(
      resource,
      new Promise(resolve => {
        resource.onReady(component => {
          componentMap.set(resource, component);
          resolve(component);
        });
      }),
    );
  }

  return function WrappedComponent(props) {
    const Component = componentMap.get(resource);
    if (Component) {
      return <Component {...props} />;
    } else {
      throw (
        loaderMap.get(resource) ?? new Error(`Loader map did not have resource`)
      );
    }
  };
}
