'use parcel-rsc-runtime';

export {
  createClientReference,
  registerServerReference,
  registerServerActions,
} from 'react-server-dom-parcel/server.edge';
export {preinit} from 'react-dom';
export {
  createResourcesProxy,
  modulePreloadResource,
  scriptPreloadResource,
  stylesheetResource,
  waitForCSS,
  wrapClientReferenceWithResources,
} from './runtime-helpers';

export function ensureAsyncLocalStorage() {
  if (typeof AsyncLocalStorage === 'undefined') {
    try {
      globalThis.AsyncLocalStorage =
        require('node:async_hooks').AsyncLocalStorage;
    } catch {
      // The edge runtime may not provide node:async_hooks.
    }
  }
}
