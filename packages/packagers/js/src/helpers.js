// @flow strict-local
import type {Environment} from '@parcel/types';

export const prelude = (parcelRequireName: string): string => `
var $parcel$modules = {};
var $parcel$inits = {};

var parcelRequire = $parcel$global[${JSON.stringify(parcelRequireName)}];

if (parcelRequire == null) {
  parcelRequire = function(id) {
    if (id in $parcel$modules) {
      return $parcel$modules[id].exports;
    }
    if (id in $parcel$inits) {
      var init = $parcel$inits[id];
      delete $parcel$inits[id];
      var module = {id: id, exports: {}};
      $parcel$modules[id] = module;
      init.call(module.exports, module, module.exports);
      return module.exports;
    }
    var err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  parcelRequire.register = function register(id, init) {
    $parcel$inits[id] = init;
  };

  $parcel$global[${JSON.stringify(parcelRequireName)}] = parcelRequire;
}

var parcelRegister = parcelRequire.register;
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
if (!$parcel$global.lb) {
  // Set of loaded bundles
  $parcel$global.lb = new Set();
  // Queue of bundles to execute once they're dep bundles are loaded
  $parcel$global.bq = [];

  // Register loaded bundle
  $parcel$global.rlb = ${fnExpr(
    env,
    ['bundle'],
    ['$parcel$global.lb.add(bundle);', '$parcel$global.pq();'],
  )}

  // Run when ready
  $parcel$global.rwr = ${fnExpr(
    env,
    // b = bundle public id
    // r = run function to execute the bundle entry
    // d = list of dependent bundles this bundle requires before executing
    ['b', 'r', 'd'],
    ['$parcel$global.bq.push({b, r, d});', '$parcel$global.pq();'],
  )}

  // Process queue
  $parcel$global.pq = ${fnExpr(
    env,
    [],
    [
      `var runnableEntry = $parcel$global.bq.find(${fnExpr(
        env,
        ['i'],
        [
          `return i.d.every(${fnExpr(
            env,
            ['dep'],
            ['return $parcel$global.lb.has(dep);'],
          )});`,
        ],
      )});`,
      'if (runnableEntry) {',
      `$parcel$global.bq = $parcel$global.bq.filter(${fnExpr(
        env,
        ['i'],
        ['return i.b !== runnableEntry.b;'],
      )});`,
      'runnableEntry.r();',
      '$parcel$global.pq();',
      '}',
    ],
  )}
}
`;

const $parcel$export = `
function $parcel$export(e, n, v, s) {
  Object.defineProperty(e, n, {get: v, set: s, enumerable: true, configurable: true});
}
`;

const $parcel$exportWildcard = `
function $parcel$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule' || dest.hasOwnProperty(key)) {
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

const $parcel$interopDefault = `
function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}
`;

const $parcel$global = (env: Environment): string => {
  if (env.supports('global-this')) {
    return `
      var $parcel$global = globalThis;
    `;
  }
  return `
      var $parcel$global =
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

const $parcel$defineInteropFlag = `
function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}
`;

export const helpers = {
  $parcel$export,
  $parcel$exportWildcard,
  $parcel$interopDefault,
  $parcel$global,
  $parcel$defineInteropFlag,
};
