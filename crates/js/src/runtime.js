/* eslint-env browser */
/* global parcelRequireName, modules, mainEntry, entries, externals */
/* eslint-disable no-unused-vars */

// Save the require from previous bundle to this closure if any
var previousRequire =
  typeof globalThis[parcelRequireName] === 'function' &&
  globalThis[parcelRequireName];

var importMap = previousRequire.i || {};
var cache = previousRequire.cache || {};

// Do not use `require` to prevent Webpack from trying to bundle this call
var nodeRequire =
  typeof module !== 'undefined' &&
  typeof module.require === 'function' &&
  module.require.bind(module);

function parcelRequire(name, jumped) {
  if (!cache[name]) {
    if (!modules[name]) {
      if (externals[name]) {
        return externals[name];
      }
      // if we cannot find the module within our internal map or
      // cache jump to the current global require ie. the last bundle
      // that was added to the page.
      var currentRequire =
        typeof globalThis[parcelRequireName] === 'function' &&
        globalThis[parcelRequireName];
      if (!jumped && currentRequire) {
        return currentRequire(name, true);
      }

      // If there are other bundles on this page the require from the
      // previous one is saved to 'previousRequire'. Repeat this as
      // many times as there are bundles until the module is found or
      // we exhaust the require chain.
      if (previousRequire) {
        return previousRequire(name, true);
      }

      // Try the node require function if it exists.
      if (nodeRequire && typeof name === 'string') {
        return nodeRequire(name);
      }

      var err = new Error("Cannot find module '" + name + "'");
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    localRequire.resolve = resolve;
    localRequire.cache = {};

    var module = (cache[name] = new parcelRequire.Module(name));
    module.require = localRequire;

    modules[name][0].call(
      module.exports,
      localRequire,
      module,
      module.exports,
      globalThis
    );
  }

  return cache[name].exports;

  function localRequire(x) {
    var res = localRequire.resolve(x);
    if (res === false) {
      return {};
    }

    if (res === true) {
      return x;
    }

    if (Array.isArray(res)) {
      var m = {__esModule: true};
      res.forEach(function (v) {
        var key = v[0];
        var id = v[1];
        var exp = v[2] || v[0];
        var x = parcelRequire(id);
        if (key === '*') {
          Object.keys(x).forEach(function (key) {
            if (
              key === 'default' ||
              key === '__esModule' ||
              Object.prototype.hasOwnProperty.call(m, key)
            ) {
              return;
            }

            Object.defineProperty(m, key, {
              enumerable: true,
              configurable: true,
              get: function () {
                return x[key];
              },
            });
          });
        } else if (exp === '*') {
          Object.defineProperty(m, key, {
            enumerable: true,
            configurable: true,
            value: x,
          });
        } else {
          Object.defineProperty(m, key, {
            enumerable: true,
            configurable: true,
            get: function () {
              if (exp === 'default') {
                return x.__esModule ? x.default : x;
              }
              return x[exp];
            },
          });
        }
      });
      return m;
    }

    return parcelRequire(res);
  }

  function resolve(x) {
    var id = modules[name][1][x];
    return id != null ? id : x;
  }
}

function Module(moduleName) {
  this.id = moduleName;
  this.bundle = parcelRequire;
  this.require = nodeRequire;
  this.exports = {};
}

parcelRequire.isParcelRequire = true;
parcelRequire.Module = Module;
parcelRequire.modules = modules;
parcelRequire.cache = cache;
parcelRequire.parent = previousRequire;
// parcelRequire.distDir = distDir;
// parcelRequire.publicUrl = publicUrl;
// parcelRequire.devServer = devServer;
parcelRequire.i = importMap;

Object.defineProperty(parcelRequire, 'root', {
  get: function () {
    return globalThis[parcelRequireName];
  },
});

globalThis[parcelRequireName] = parcelRequire;

function parcelLoadJS(bundleId) {
  let url = importMap[bundleId] || bundleId;
  return import(url);
}

function parcelLoadCSS(bundleId) {
  let url = importMap[bundleId] || bundleId;
  return new Promise(function (resolve, reject) {
    if (typeof document === 'undefined') {
      return resolve();
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;

    // Don't insert the same link element twice (e.g. if it was already in the HTML)
    let existingLinks = document.getElementsByTagName('link');
    let isCurrentBundle = function (existing) {
      return (
        existing.href === link.href && existing.rel.indexOf('stylesheet') > -1
      );
    };

    if (Array.from(existingLinks).some(isCurrentBundle)) {
      resolve();
      return;
    }

    link.onerror = function (e) {
      link.onerror = link.onload = null;
      link.remove();
      reject(e);
    };

    link.onload = function () {
      link.onerror = link.onload = null;
      resolve();
    };

    document.getElementsByTagName('head')[0].appendChild(link);
  });
}

if (entries) {
  for (var i = 0; i < entries.length; i++) {
    parcelRequire(entries[i]);
  }
}

if (mainEntry) {
  // Expose entry point to Node, AMD or browser globals
  // Based on https://github.com/ForbesLindesay/umd/blob/master/template.js
  var mainExports = parcelRequire(mainEntry);

  // CommonJS
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = mainExports;

    // RequireJS
  } else if (typeof define === 'function' && define.amd) {
    define(function () {
      return mainExports;
    });
  }
}
