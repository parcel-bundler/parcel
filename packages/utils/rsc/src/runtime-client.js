'use parcel-rsc-runtime';

export {createServerReference} from 'react-server-dom-parcel/client';
export {preinit} from 'react-dom';
export {
  createResourcesProxy,
  modulePreloadResource,
  scriptPreloadResource,
  stylesheetResource,
  waitForCSS,
  wrapClientReferenceWithResources,
} from './runtime-helpers';
