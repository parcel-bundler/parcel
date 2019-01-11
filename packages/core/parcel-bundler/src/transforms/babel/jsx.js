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
 * Solves a use case where people use JSX in .js files
 */
function isUsingJSXinJS(asset) {
  // matches import * as React from 'react' and alike
  const es6Candidate = /from\s+[`"'](react|preact|nervjs|hyperapp)[`"']/;
  // matches const React = require('react') and alike
  const commonJSCandidate = /require\([`"'](react|preact|nervjs|hyperapp)[`"']\)/;

  if (asset.contents.match(es6Candidate)) {
    return true;
  }

  if (asset.contents.match(commonJSCandidate)) {
    return true;
  }

  return false;
}

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

  if (
    pragma ||
    JSX_EXTENSIONS[path.extname(asset.name)] ||
    isUsingJSXinJS(asset)
  ) {
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
