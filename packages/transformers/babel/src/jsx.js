// @flow
import type {Config} from '@parcel/types';
import path from 'path';

const JSX_EXTENSIONS = {
  '.jsx': true,
  '.tsx': true
};

const JSX_PRAGMA = {
  react: {
    pragma: 'React.createElement',
    pragmaFrag: 'React.Fragment'
  },
  preact: {
    pragma: 'h',
    pragmaFrag: 'Fragment'
  },
  nervjs: {
    pragma: 'Nerv.createElement',
    pragmaFrag: undefined
  },
  hyperapp: {
    pragma: 'h',
    pragmaFrag: undefined
  }
};

/**
 * Generates a babel config for JSX. Attempts to detect react or react-like libraries
 * and changes the pragma accordingly.
 */
export default async function getJSXOptions(config: Config) {
  if (!config.isSource) {
    return null;
  }

  // Find a dependency that we can map to a JSX pragma
  const pkg = await config.getPackage();
  const reactLib = Object.keys(JSX_PRAGMA).find(
    libName =>
      pkg &&
      ((pkg.dependencies && pkg.dependencies[libName]) ||
        (pkg.devDependencies && pkg.devDependencies[libName]))
  );

  const pragma = reactLib ? JSX_PRAGMA[reactLib].pragma : undefined;
  const pragmaFrag = reactLib ? JSX_PRAGMA[reactLib].pragmaFrag : undefined;

  if (pragma || JSX_EXTENSIONS[path.extname(config.searchPath)]) {
    return {
      plugins: [['@babel/plugin-transform-react-jsx', {pragma, pragmaFrag}]]
    };
  }
}
