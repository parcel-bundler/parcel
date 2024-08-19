// @flow strict-local
import type {Environment} from '@atlaspack/types';

export const prelude = (atlaspackRequireName: string): string => `
var $atlaspack$modules = {};
var $atlaspack$inits = {};

var atlaspackRequire = $atlaspack$global[${JSON.stringify(
  atlaspackRequireName,
)}];

if (atlaspackRequire == null) {
  atlaspackRequire = function(id) {
    if (id in $atlaspack$modules) {
      return $atlaspack$modules[id].exports;
    }
    if (id in $atlaspack$inits) {
      var init = $atlaspack$inits[id];
      delete $atlaspack$inits[id];
      var module = {id: id, exports: {}};
      $atlaspack$modules[id] = module;
      init.call(module.exports, module, module.exports);
      return module.exports;
    }
    var err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  atlaspackRequire.register = function register(id, init) {
    $atlaspack$inits[id] = init;
  };

  $atlaspack$global[${JSON.stringify(atlaspackRequireName)}] = atlaspackRequire;
}

var atlaspackRegister = atlaspackRequire.register;
`;

export const fnExpr = (
  env: Environment,
  params: Array<string>,
  body: Array<string>,
): string => {
  let block = `{ ${body.join(' ')} }`;

  if (env.supports('arrow-functions')) {
    return `(${params.join(', ')}) => ${block}`;
  }

  return `function (${params.join(', ')}) ${block}`;
};

export const bundleQueuePrelude = (env: Environment): string => `
if (!$atlaspack$global.lb) {
  // Set of loaded bundles
  $atlaspack$global.lb = new Set();
  // Queue of bundles to execute once they're dep bundles are loaded
  $atlaspack$global.bq = [];

  // Register loaded bundle
  $atlaspack$global.rlb = ${fnExpr(
    env,
    ['bundle'],
    ['$atlaspack$global.lb.add(bundle);', '$atlaspack$global.pq();'],
  )}

  // Run when ready
  $atlaspack$global.rwr = ${fnExpr(
    env,
    // b = bundle public id
    // r = run function to execute the bundle entry
    // d = list of dependent bundles this bundle requires before executing
    ['b', 'r', 'd'],
    ['$atlaspack$global.bq.push({b, r, d});', '$atlaspack$global.pq();'],
  )}

  // Process queue
  $atlaspack$global.pq = ${fnExpr(
    env,
    [],
    [
      `var runnableEntry = $atlaspack$global.bq.find(${fnExpr(
        env,
        ['i'],
        [
          `return i.d.every(${fnExpr(
            env,
            ['dep'],
            ['return $atlaspack$global.lb.has(dep);'],
          )});`,
        ],
      )});`,
      'if (runnableEntry) {',
      `$atlaspack$global.bq = $atlaspack$global.bq.filter(${fnExpr(
        env,
        ['i'],
        ['return i.b !== runnableEntry.b;'],
      )});`,
      'runnableEntry.r();',
      '$atlaspack$global.pq();',
      '}',
    ],
  )}
}
`;

const $atlaspack$export = `
function $atlaspack$export(e, n, v, s) {
  Object.defineProperty(e, n, {get: v, set: s, enumerable: true, configurable: true});
}
`;

const $atlaspack$exportWildcard = `
function $atlaspack$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule' || Object.prototype.hasOwnProperty.call(dest, key)) {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      get: function get() {
        return source[key];
      }
    });
  });

  return dest;
}
`;

const $atlaspack$interopDefault = `
function $atlaspack$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}
`;

const $atlaspack$global = (env: Environment): string => {
  if (env.supports('global-this')) {
    return `
      var $atlaspack$global = globalThis;
    `;
  }
  return `
      var $atlaspack$global =
        typeof globalThis !== 'undefined'
          ? globalThis
          : typeof self !== 'undefined'
          ? self
          : typeof window !== 'undefined'
          ? window
          : typeof global !== 'undefined'
          ? global
          : {};
  `;
};

const $atlaspack$defineInteropFlag = `
function $atlaspack$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}
`;

export const helpers = {
  $atlaspack$export,
  $atlaspack$exportWildcard,
  $atlaspack$interopDefault,
  $atlaspack$global,
  $atlaspack$defineInteropFlag,
};
