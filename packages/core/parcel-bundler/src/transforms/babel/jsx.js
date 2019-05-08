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

function createJSXRegexFor(dependency) {
  // result looks like /from\s+[`"']react[`"']|require\([`"']react[`"']\)/
  return new RegExp(
    `from\\s+[\`"']${dependency}[\`"']|require\\([\`"']${dependency}[\`"']\\)`
  );
}

/**
 * Solves a use case when JSX is used in .js files, but
 * package.json is empty or missing yet and therefore pragma cannot
 * be determined based on pkg.dependencies / pkg.devDependencies
 */
const cacheJsxRegexFor = {};
function maybeCreateFallbackPragma(asset) {
  for (const dep in JSX_PRAGMA) {
    let regex = cacheJsxRegexFor[dep];

    if (!regex) {
      regex = createJSXRegexFor(dep);
      cacheJsxRegexFor[dep] = regex;
    }

    if (asset.contents.match(regex)) {
      return JSX_PRAGMA[dep];
    }
  }
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

  if (!pragma) {
    pragma = maybeCreateFallbackPragma(asset);
  }

  if (pragma || JSX_EXTENSIONS[path.extname(asset.name)]) {
    return {
      internal: true,
      babelVersion: 7,
      config: {
        plugins: [
          [
            require('@babel/plugin-transform-react-jsx'),
            {
              pragma,
              pragmaFrag: 'React.Fragment'
            }
          ]
        ]
      }
    };
  }
}

module.exports = getJSXConfig;
