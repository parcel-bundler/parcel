/* eslint-env browser */
/* global parcelRequireName, modules, mainEntry, entries, externals, distDir, publicUrl */
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

function require(name, jumped) {
  if (!cache[name]) {
    if (!modules[name]) {
      if (Object.prototype.hasOwnProperty.call(externals, name)) {
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

    var module = (cache[name] = new require.Module(name));

    modules[name].call(
      module.exports,
      module,
      module.exports,
    );
  }

  return cache[name].exports;
}

function Module(moduleName) {
  this.id = moduleName;
  this.bundle = require;
  this.require = require;
  this.exports = {};
}

require.isParcelRequire = true;
require.Module = Module;
require.modules = modules;
require.cache = cache;
require.parent = previousRequire;
require.distDir = distDir;
require.publicUrl = publicUrl;
require.i = importMap;

Object.defineProperty(require, 'root', {
  get: function () {
    return globalThis[parcelRequireName];
  },
});

globalThis[parcelRequireName] = require;

function parcelLoadJS(bundleId) {
  // Bundle ids are relative to the dist root; `distDir` is the path from this
  // bundle's directory back to that root, so the import resolves correctly
  // regardless of where this bundle is nested.
  return import(distDir + (importMap[bundleId] || bundleId));
}

function parcelResolve(bundleId) {
  return publicUrl + (importMap[bundleId] || bundleId);
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

require.loadJS = parcelLoadJS;
require.nodeRequire = nodeRequire;
require.load = parcelLoadJS;
require.loadCSS = parcelLoadCSS;
require.resolve = parcelResolve;
require.extendImportMap = function (map) {
  Object.assign(importMap, map);
};

if (entries) {
  for (var i = 0; i < entries.length; i++) {
    require(entries[i]);
  }
}

if (mainEntry) {
  // Expose entry point to Node, AMD or browser globals
  // Based on https://github.com/ForbesLindesay/umd/blob/master/template.js
  var mainExports = require(mainEntry);

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
