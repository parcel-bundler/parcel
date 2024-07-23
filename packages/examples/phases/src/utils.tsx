import React, {FC, useEffect} from 'react';

export function deferredLoadComponent<T>(
  Resource: DeferredImport<T extends {default: any} ? T : never>,
): FC {
  let loaded = false;
  let cleanUp: undefined | (() => void);
  return function WrappedComponent(props) {
    useEffect(() => {
      return () => {
        cleanUp?.();
      };
    }, []);
    if (loaded) {
      return <Resource.mod.default {...props} />;
    } else {
      throw new Promise(resolve => {
        cleanUp = Resource.onReady(() => {
          loaded = true;
          resolve(Resource);
        });
      });
    }
  };
}
