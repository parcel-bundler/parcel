const path = require('path');

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
async function getJSXConfig(asset, isSourceModule) {
  // Don't enable JSX in node_modules
  if (!isSourceModule) {
    return null;
  }

  let pkg = await asset.getPackage();

  // Find a dependency that we can map to a JSX pragma
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

  if (pragma || JSX_EXTENSIONS[path.extname(asset.name)]) {
    return {
      internal: true,
      babelVersion: 7,
      config: {
        plugins: [[require('@babel/plugin-transform-react-jsx'), {pragma}]]
      }
    };
  }
}

module.exports = getJSXConfig;
