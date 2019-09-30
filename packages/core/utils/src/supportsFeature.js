// @flow strict-local
import type {Environment} from '@parcel/types';

// List of engines that support object destructuring syntax
const DESTRUCTURING_ENGINES = {
  chrome: '51',
  edge: '15',
  firefox: '53',
  safari: '10',
  node: '6.5',
  ios: '10',
  samsung: '5',
  opera: '38',
  electron: '1.2'
};

// List of browsers that support dynamic import natively
const DYNAMIC_IMPORT_ENGINES = {
  edge: '76',
  firefox: '67',
  chrome: '63',
  safari: '11.1',
  opera: '50'
};

export default {
  destructuring(env: Environment) {
    return env.matchesEngines(DESTRUCTURING_ENGINES);
  },

  dynamicImport(env: Environment) {
    return env.matchesEngines(DYNAMIC_IMPORT_ENGINES);
  }
};
