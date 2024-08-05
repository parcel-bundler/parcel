import React, {
  ComponentType,
  ForwardRefExoticComponent,
  ForwardedRef,
  MemoExoticComponent,
  PropsWithChildren,
  PropsWithoutRef,
  RefAttributes,
  forwardRef,
  memo,
} from 'react';

export function deferredLoadComponent<P extends {[k: string]: any} | undefined>(
  resource: DeferredImport<{default: ComponentType<P>}>,
): MemoExoticComponent<
  ForwardRefExoticComponent<
    PropsWithoutRef<P> & RefAttributes<ComponentType<P>>
  >
> {
  // Create a deferred component map in the global context, so we can reuse the components everywhere
  if (!globalThis.deferredComponentMap) {
    globalThis.deferredComponentMap = new WeakMap<DeferredImport<any>, any>();
  }

  if (globalThis.deferredComponentMap.has(resource)) {
    return globalThis.deferredComponentMap.get(resource);
  }

  let Component: ComponentType | undefined;
  let loader = new Promise(resolve => {
    resource.onReady(loaded => {
      Component = loaded;
      resolve(loaded);
    });
  });

  const wrapper = function DeferredComponent(
    props: PropsWithChildren<P>,
    ref: ForwardedRef<ComponentType<P>>,
  ) {
    if (Component) {
      return <Component {...props} ref={ref} />;
    }

    throw loader;
  };

  // Support refs in the deferred component
  const forwardedRef = forwardRef(wrapper);

  // Memoise so we avoid re-renders
  const memoised = memo(forwardedRef);

  // Store in weak map so we only have one instance
  globalThis.deferredComponentMap.set(resource, memoised);
  return memoised;
}
