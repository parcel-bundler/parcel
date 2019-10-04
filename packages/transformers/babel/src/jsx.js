// @flow
import type {Config} from '@parcel/types';
import path from 'path';

const JSX_EXTENSIONS = {
  '.jsx': true,
  '.tsx': true
};

const JSX_PRAGMA = {
  react: 'React.createElement',
  preact: 'h',
  nervjs: 'Nerv.createElement',
  hyperapp: 'h'
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
  let pkg = await config.getPackage();
  let pragma = null;
  for (let dep in JSX_PRAGMA) {
    if (
      pkg &&
      ((pkg.dependencies && pkg.dependencies[dep]) ||
        (pkg.devDependencies && pkg.devDependencies[dep]))
    ) {
      pragma = JSX_PRAGMA[dep];
      break;
    }
  }

  if (pragma || JSX_EXTENSIONS[path.extname(config.searchPath)]) {
    return {
      plugins: [['@babel/plugin-transform-react-jsx', {pragma}]]
    };
  }
}
