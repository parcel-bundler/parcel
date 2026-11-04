/* global parcelRequireName, modules, mainEntry, entries, awaitedBundles, externals, manifest, distDir, publicUrl, bundleUrl */

// Save the require from previous bundle to this closure if any
var previousRequire =
  typeof globalThis[parcelRequireName] === 'function' &&
  globalThis[parcelRequireName];

var importMap = previousRequire.i || {};
// Maps stable bundle keys to content hashed names for the bundles this context can load. Every
// bundle shares one map. The first runtime on a page seeds it from the page's manifest (see the HTML
// packager), a JSON data block rather than an inline script so Content Security Policies allow it.
// Context roots that aren't loaded by a page add their own.
if (
  !previousRequire &&
  typeof document !== 'undefined' &&
  typeof document.querySelectorAll === 'function'
) {
  var pageManifests = document.querySelectorAll(
    'script[type="application/json"][data-parcel-manifest]',
  );
  for (var i = 0; i < pageManifests.length; i++) {
    Object.assign(importMap, JSON.parse(pageManifests[i].textContent));
  }
}
Object.assign(importMap, manifest);
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

    modules[name].call(module.exports, module, module.exports);
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
  var name = importMap[bundleId] || bundleId;
  // In Node, bundles are referenced by their file URLs. Bundle ids are dist-root-relative, and
  // `distDir` is the path from this bundle's directory back to that root.
  return bundleUrl ? new URL(distDir + name, bundleUrl).href : publicUrl + name;
}

// Pending and completed stylesheet loads by URL, shared by every bundle on the page so concurrent
// loads of the same stylesheet wait on one link.
var cssLoads = (require.cssLoads = previousRequire.cssLoads || {});

function parcelLoadCSS(bundleId, media) {
  // Like parcelResolve: bundle ids are dist-root-relative, and link hrefs resolve against the
  // document rather than this bundle, so they must be based on the public URL.
  var url = publicUrl + (importMap[bundleId] || bundleId);
  if (cssLoads[url]) {
    return cssLoads[url];
  }

  return (cssLoads[url] = new Promise(function (resolve, reject) {
    if (typeof document === 'undefined') {
      return resolve();
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    // Every rule is already wrapped in its own condition; the attribute only
    // lets the browser deprioritize a stylesheet that cannot apply.
    link.media = media || '';

    // Don't insert a stylesheet that is already on the page (e.g. from the HTML). Like other
    // bundlers, this keeps its existing position even if a fresh load would order it differently:
    // duplicate links multiply the number of rules the browser must match and can be very slow.
    var existing = document.getElementsByTagName('link');
    for (var i = 0; i < existing.length; i++) {
      if (
        existing[i].href === link.href &&
        existing[i].relList.contains('stylesheet')
      ) {
        return resolve();
      }
    }

    link.onerror = function (e) {
      link.onerror = link.onload = null;
      link.remove();
      delete cssLoads[url];
      reject(e);
    };

    link.onload = function () {
      link.onerror = link.onload = null;
      resolve();
    };

    // Lazily loaded styles apply after everything already in the document,
    // which may include stylesheets emitted in <body>; appending to <head>
    // would jump ahead of those. Insert after the last current stylesheet.
    var sheets = document.querySelectorAll('link[rel~="stylesheet"], style');
    var last = sheets[sheets.length - 1];
    if (last && last.parentNode) {
      last.parentNode.insertBefore(link, last.nextSibling);
    } else {
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  }));
}

require.loadJS = parcelLoadJS;
require.nodeRequire = nodeRequire;
require.load = parcelLoadJS;
require.loadCSS = parcelLoadCSS;
require.resolve = parcelResolve;
require.extendImportMap = function (map) {
  Object.assign(importMap, map);
};

function runEntries() {
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
}

// A root a page runs as soon as it has loaded (e.g. `<script type="module" async>`) may run before
// the page's tags for the bundles it depends on, so it loads them first. The browser shares one
// module instance per URL, so this doesn't load them twice.
if (awaitedBundles.length) {
  Promise.all(
    awaitedBundles.map(function (bundleId) {
      return parcelLoadJS(bundleId);
    }),
  ).then(runEntries);
} else {
  runEntries();
}
