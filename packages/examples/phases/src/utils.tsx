import React, {
  ComponentType,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  RefAttributes,
  forwardRef,
} from 'react';

export function deferredLoadComponent<P extends {[k: string]: any} | undefined>(
  resource: DeferredImport<{default: ComponentType<P>}>,
): ForwardRefExoticComponent<
  PropsWithoutRef<P> & RefAttributes<ComponentType<P>>
> {
  // Create a deferred component map in the global context, so we can reuse the components everywhere
  if (!globalThis.deferredComponentMap) {
    globalThis.deferredComponentMap = new WeakMap<DeferredImport<any>, any>();
  }

  if (globalThis.deferredComponentMap.has(resource)) {
    return globalThis.deferredComponentMap.get(resource);
  }

  let Component: ComponentType | undefined;
  const loader = new Promise(resolve => {
    resource.onReady(loaded => {
      Component = loaded;
      resolve(loaded);
    });
  });

  const wrapper = forwardRef<ComponentType<P>, P>(function DeferredComponent(
    props,
    ref,
  ) {
    if (Component) {
      return <Component {...props} ref={ref} />;
    } else {
      throw loader;
    }
  });

  // Store in weakmap so we only have one instance
  globalThis.deferredComponentMap.set(resource, wrapper);
  return wrapper;
}
