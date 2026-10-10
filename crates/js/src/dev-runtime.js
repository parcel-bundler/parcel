/* eslint-env browser */
/* global parcelRequireName, modules, mainEntry, entries, awaitedBundles, externals, manifest, distDir, publicUrl, HMR_ENABLED, HMR_HOST, HMR_PORT */
/* eslint-disable no-unused-vars */

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

function parcelRequire(name, jumped) {
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

    localRequire.resolve = resolve;
    localRequire.cache = {};

    var module = (cache[name] = new parcelRequire.Module(name));
    module.require = localRequire;

    modules[name][0].call(
      module.exports,
      module,
      module.exports,
      localRequire,
      globalThis,
    );

    // A module that replaced its exports object (e.g. `module.exports = ...`) can't be updated in
    // place, so importers that kept the previous one get its previous properties back.
    var previous = module._previousExports;
    if (previous) {
      module._previousExports = undefined;
      if (module.exports !== previous.exports) {
        Object.defineProperties(previous.exports, previous.descriptors);
      }
    }
  }

  return cache[name].exports;

  function localRequire(x) {
    var res = localRequire.resolve(x);
    if (res === false) {
      return {};
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
    } else if (res && typeof res === 'object' && res.value) {
      return res.value;
    }

    return parcelRequire(res);
  }

  function resolve(x) {
    var id = modules[name][1][x];
    return id != null ? id : x;
  }
}

parcelRequire.isParcelRequire = true;
parcelRequire.Module = Module;
parcelRequire.modules = modules;
parcelRequire.cache = cache;
parcelRequire.parent = previousRequire;
parcelRequire.distDir = distDir;
parcelRequire.publicUrl = publicUrl;
parcelRequire.i = importMap;
parcelRequire.hotData = {};
// The exports objects of disposed modules, by id, which they are re-run into. Shared by all bundles,
// like `cache`, since a module may be disposed through a different bundle than the one defining it.
parcelRequire.hotExports = previousRequire.hotExports || {};

Object.defineProperty(parcelRequire, 'root', {
  get: function () {
    return globalThis[parcelRequireName];
  },
});

globalThis[parcelRequireName] = parcelRequire;

function parcelLoadJS(bundleId) {
  // Bundle ids are relative to the dist root; `distDir` is the path from this
  // bundle's directory back to that root, so the import resolves correctly
  // regardless of where this bundle is nested.
  return import(distDir + (importMap[bundleId] || bundleId));
}

function parcelResolve(bundleId) {
  return publicUrl + (importMap[bundleId] || bundleId);
}

function parcelLoadCSS(bundleId, media) {
  // Like parcelResolve: bundle ids are dist-root-relative, and link hrefs resolve against the
  // document rather than this bundle, so they must be based on the public URL.
  let url = publicUrl + (importMap[bundleId] || bundleId);
  return new Promise(function (resolve, reject) {
    if (typeof document === 'undefined') {
      return resolve();
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    // Every rule is already wrapped in its own condition; the attribute only
    // lets the browser deprioritize a stylesheet that cannot apply.
    link.media = media || '';

    // Insert a link even when one with the same href already exists: an
    // earlier activation may have loaded it at a position incompatible with
    // this activation's cascade order. A fresh link re-applies the cached
    // stylesheet at this activation's position, so each activation asserts
    // its own order and the last one wins, as per-link markup would natively.
    link.onerror = function (e) {
      link.onerror = link.onload = null;
      link.remove();
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
  });
}

parcelRequire.loadJS = parcelLoadJS;
parcelRequire.load = parcelLoadJS;
parcelRequire.nodeRequire = nodeRequire;
parcelRequire.loadCSS = parcelLoadCSS;
parcelRequire.resolve = parcelResolve;
parcelRequire.extendImportMap = function (map) {
  Object.assign(importMap, map);
};

function runEntries() {
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

var HMR_SERVER_PORT = null;
var HMR_SECURE = false;
var HMR_USE_SSE = false;
parcelRequire.HMR_BUNDLE_ID = 'TODO';
var OVERLAY_ID = '__parcel__error__overlay__';

function Module(moduleName) {
  this.id = moduleName;
  this.bundle = parcelRequire;
  this.require = nodeRequire;
  this.exports = {};

  if (!HMR_ENABLED) {
    return;
  }

  // Re-run a disposed module into its previous exports object, so importers that kept it (including
  // dynamic imports, which resolve to it once) see the new exports when they next read them.
  var exports = parcelRequire.hotExports[moduleName];
  if (exports) {
    parcelRequire.hotExports[moduleName] = undefined;
    var descriptors = clearExports(exports);
    if (descriptors) {
      this.exports = exports;
      this._previousExports = {exports: exports, descriptors: descriptors};
    }
  }
  // Only this object is reused. One the module replaces it with may be shared with other code.
  this._ownExports = this.exports;

  var module = this;
  this.hot = {
    data: parcelRequire.hotData[moduleName],
    _acceptCallbacks: [],
    // Callbacks for accepted updates to dependencies, by dependency id.
    _acceptedDependencies: {},
    _disposeCallbacks: [],
    // `accept(callback)` accepts updates to this module, which is re-run, and then the callback is
    // called. `accept(dependencies, callback)` accepts updates to the given dependencies (with the
    // same specifiers as their imports), which are re-run, and then the callback is called with
    // their ids. This module isn't re-run.
    accept: function (dependencies, fn) {
      if (typeof dependencies === 'string' || Array.isArray(dependencies)) {
        var callback = fn || function () {};
        [].concat(dependencies).forEach(function (dependency) {
          var id = module.require.resolve
            ? module.require.resolve(dependency)
            : dependency;
          if (typeof id === 'string') {
            var callbacks = this._acceptedDependencies[id];
            if (!callbacks) {
              callbacks = this._acceptedDependencies[id] = [];
            }
            callbacks.push(callback);
          }
        }, this);
      } else {
        this._acceptCallbacks.push(dependencies || function () {});
      }
    },
    dispose: function (fn) {
      this._disposeCallbacks.push(fn);
    },
  };
  parcelRequire.hotData[moduleName] = undefined;
}

// Removes all properties from a disposed module's exports object, returning their descriptors.
// Returns null if one can't be removed, in which case the module gets a new object instead.
function clearExports(exports) {
  if (!Object.isExtensible(exports)) {
    return null;
  }
  var descriptors = Object.getOwnPropertyDescriptors(exports);
  for (var key in descriptors) {
    if (!descriptors[key].configurable) {
      return null;
    }
  }
  for (var key2 in descriptors) {
    delete exports[key2];
  }
  return descriptors;
}

var checkedAssets /*: {|[string]: boolean|} */,
  disposedAssets /*: {|[string]: boolean|} */,
  assetsToDispose /*: Array<[ParcelRequire, string]> */,
  assetsToAccept /*: Array<[ParcelRequire, string]> */,
  // Accepted dependency updates: the accepting module's bundle, its id, and the dependency's id.
  dependenciesToAccept /*: Array<[ParcelRequire, string, string]> */,
  // Set by `fullReload` when the process started by `parcel run` must be restarted.
  restartRequested = false;

function getHostname() {
  return (
    HMR_HOST ||
    (typeof location !== 'undefined' && location.protocol.indexOf('http') === 0
      ? location.hostname
      : 'localhost')
  );
}

function getPort() {
  return (
    HMR_PORT ||
    (typeof location !== 'undefined' ? location.port : HMR_SERVER_PORT)
  );
}

var hostname = getHostname();
var port = getPort();
var protocol =
  HMR_SECURE ||
  (typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    !['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname))
    ? 'wss'
    : 'ws';

// eslint-disable-next-line no-redeclare
var parent = parcelRequire.parent;
// Safari doesn't support sourceURL in error stacks.
// eval may also be disabled via CSP, so do a quick check.
var supportsSourceURL = true;
if (HMR_ENABLED) {
  try {
    (0, eval)('throw new Error("test"); //# sourceURL=test.js');
  } catch (err) {
    supportsSourceURL = String(err.stack).includes('test.js');
  }
}

if (HMR_ENABLED && (!parent || !parent.isParcelRequire)) {
  // Web extension context
  var extCtx =
    typeof browser === 'undefined'
      ? typeof chrome === 'undefined'
        ? null
        : chrome
      : browser;

  var ws;
  // `parcel run` tells the process it starts where to connect. Only the first runtime to start
  // connects, and child processes it starts in turn don't inherit the URL.
  var runnerUrl = globalThis.process?.env?.PARCEL_HMR_URL;
  if (runnerUrl) {
    delete globalThis.process.env.PARCEL_HMR_URL;
  }
  if (runnerUrl && typeof WebSocket !== 'undefined') {
    // After each update, `parcel run` waits for a reply saying whether it was applied or the
    // process needs to be restarted, and only then updates browsers, so that pages they reload are
    // rendered by the new code.
    ws = new WebSocket(runnerUrl);
    ws.onopen = function () {
      // The entry has run by the time the connection opens.
      ws.send(JSON.stringify({type: 'ready'}));
    };
  } else if (HMR_USE_SSE) {
    ws = new EventSource('/__parcel_hmr');
  } else if (
    typeof WebSocket !== 'undefined' &&
    (typeof window !== 'undefined' || !globalThis.process?.versions?.node)
  ) {
    try {
      ws = new WebSocket(
        protocol + '://' + hostname + (port ? ':' + port : '') + '/',
      );
    } catch (err) {
      // Ignore cloudflare workers error.
      if (
        err.message &&
        !err.message.includes('Disallowed operation called within global scope')
      ) {
        console.error(err.message);
      }
    }
  }

  if (ws) {
    // $FlowFixMe
    ws.onmessage = async function (event /*: {data: string, ...} */) {
      var data /*: HMRMessage */ = JSON.parse(event.data);
      if (!runnerUrl) {
        await handleMessage(data);
        return;
      }

      restartRequested = false;
      try {
        await handleMessage(data);
      } catch (err) {
        console.error(err);
        restartRequested = true;
      }
      ws.send(JSON.stringify({type: restartRequested ? 'restart' : 'updated'}));
    };

    if (typeof WebSocket !== 'undefined' && ws instanceof WebSocket) {
      ws.onerror = function (e) {
        if (e.message) {
          console.error(e.message);
        }
      };

      ws.onclose = function (e) {
        // if (process.env.PARCEL_BUILD_ENV !== 'test') {
        console.warn('[parcel] 🚨 Connection to the HMR server was lost');
        // }
      };
    }
  }
}

async function handleMessage(data /*: HMRMessage */) {
  checkedAssets = ({} /*: {|[string]: boolean|} */);
  disposedAssets = ({} /*: {|[string]: boolean|} */);
  assetsToAccept = [];
  dependenciesToAccept = [];
  assetsToDispose = [];

  if (data.type === 'reload') {
    fullReload();
  } else if (data.type === 'update') {
    // Remove error overlay if there is one
    if (typeof document !== 'undefined') {
      removeErrorOverlay();
    }

    let assets = data.assets;

    // Handle HMR Update
    let handled = assets.every(asset => {
      return (
        asset.type === 'css' ||
        (asset.type === 'js' &&
          hmrAcceptCheck(parcelRequire.root, asset.id, asset.depsByBundle))
      );
    });

    // Code that only runs on the server changed, so the page should be reloaded. This event
    // gives the client an opportunity to refresh without losing state (e.g. via React Server
    // Components). If e.preventDefault() is not called, we will trigger a full page reload.
    if (
      handled &&
      data.serverChanged &&
      typeof window !== 'undefined' &&
      typeof CustomEvent !== 'undefined'
    ) {
      handled = !window.dispatchEvent(
        new CustomEvent('parcelhmrreload', {cancelable: true}),
      );
    }

    if (handled) {
      console.clear();

      // Dispatch custom event so other runtimes (e.g React Refresh) are aware.
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('parcelhmraccept'));
      }

      await hmrApplyUpdates(assets);

      hmrDisposeQueue();

      // Run accept callbacks. This will also re-execute other disposed assets in topological order.
      let processedAssets = {};
      for (let i = 0; i < assetsToAccept.length; i++) {
        let id = assetsToAccept[i][1];

        if (!processedAssets[id]) {
          hmrAccept(assetsToAccept[i][0], id);
          processedAssets[id] = true;
        }
      }

      hmrAcceptDependencies();
    } else fullReload();
  }

  if (data.type === 'error') {
    // Log parcel errors to console
    for (let ansiDiagnostic of data.diagnostics.ansi) {
      let stack = ansiDiagnostic.codeframe
        ? ansiDiagnostic.codeframe
        : ansiDiagnostic.stack;

      console.error(
        '🚨 [parcel]: ' +
          ansiDiagnostic.message +
          '\n' +
          stack +
          '\n\n' +
          ansiDiagnostic.hints.join('\n'),
      );
    }

    if (typeof document !== 'undefined') {
      // Render the fancy html overlay
      removeErrorOverlay();
      var overlay = createErrorOverlay(data.diagnostics.html);
      // $FlowFixMe
      document.body.appendChild(overlay);
    }
  }
}

if (globalThis.__parcel_hmr_test__) {
  globalThis.__parcel_hmr_test__.handleMessage = handleMessage;
  globalThis.__parcel_hmr_test__.parcelRequire = parcelRequire;
}

function removeErrorOverlay() {
  var overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
    console.log('[parcel] ✨ Error resolved');
  }
}

function createErrorOverlay(diagnostics) {
  var overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

  let errorHTML =
    '<div style="background: black; opacity: 0.85; font-size: 16px; color: white; position: fixed; height: 100%; width: 100%; top: 0px; left: 0px; padding: 30px; font-family: Menlo, Consolas, monospace; z-index: 9999;">';

  for (let diagnostic of diagnostics) {
    let stack = diagnostic.frames.length
      ? diagnostic.frames.reduce((p, frame) => {
          return `${p}
<a href="${
            protocol === 'wss' ? 'https' : 'http'
          }://${hostname}:${port}/__parcel_launch_editor?file=${encodeURIComponent(
            frame.location,
          )}" style="text-decoration: underline; color: #888" onclick="fetch(this.href); return false">${
            frame.location
          }</a>
${frame.code}`;
        }, '')
      : diagnostic.stack;

    errorHTML += `
      <div>
        <div style="font-size: 18px; font-weight: bold; margin-top: 20px;">
          🚨 ${diagnostic.message}
        </div>
        <pre>${stack}</pre>
        <div>
          ${diagnostic.hints.map(hint => '<div>💡 ' + hint + '</div>').join('')}
        </div>
        ${
          diagnostic.documentation
            ? `<div>📝 <a style="color: violet" href="${diagnostic.documentation}" target="_blank">Learn more</a></div>`
            : ''
        }
      </div>
    `;
  }

  errorHTML += '</div>';

  overlay.innerHTML = errorHTML;

  return overlay;
}

function fullReload() {
  if (typeof location !== 'undefined' && 'reload' in location) {
    location.reload();
  } else if (
    typeof extCtx !== 'undefined' &&
    extCtx &&
    extCtx.runtime &&
    extCtx.runtime.reload
  ) {
    extCtx.runtime.reload();
  } else if (runnerUrl) {
    // `parcel run` restarts the process once the update is handled.
    restartRequested = true;
  } else {
    console.error(
      '[parcel] ⚠️ An HMR update was not accepted. Please restart the process.',
    );
  }
}

function getParents(bundle, id) /*: Array<[ParcelRequire, string]> */ {
  var modules = bundle.modules;
  if (!modules) {
    return [];
  }

  var parents = [];
  var k, d, dep;

  for (k in modules) {
    for (d in modules[k][1]) {
      dep = modules[k][1][d];

      if (dep === id || (Array.isArray(dep) && dep[dep.length - 1] === id)) {
        parents.push([bundle, k]);
      }
    }
  }

  if (bundle.parent) {
    parents = parents.concat(getParents(bundle.parent, id));
  }

  return parents;
}

function updateLink(link) {
  var href = link.getAttribute('href');

  if (!href) {
    return;
  }
  var newLink = link.cloneNode();
  newLink.onload = function () {
    if (link.parentNode !== null) {
      // $FlowFixMe
      link.parentNode.removeChild(link);
    }
  };
  newLink.setAttribute(
    'href',
    // $FlowFixMe
    href.split('?')[0] + '?' + Date.now(),
  );
  // $FlowFixMe
  link.parentNode.insertBefore(newLink, link.nextSibling);
}

var cssTimeout = null;
function reloadCSS() {
  if (cssTimeout || typeof document === 'undefined') {
    return;
  }

  cssTimeout = setTimeout(function () {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      // $FlowFixMe[incompatible-type]
      var href /*: string */ = links[i].getAttribute('href');
      var hostname = getHostname();
      var servedFromHMRServer =
        hostname === 'localhost'
          ? new RegExp(
              '^(https?:\\/\\/(0.0.0.0|127.0.0.1)|localhost):' + getPort(),
            ).test(href)
          : href.indexOf(hostname + ':' + getPort());
      var absolute =
        /^https?:\/\//i.test(href) &&
        href.indexOf(location.origin) !== 0 &&
        !servedFromHMRServer;
      if (!absolute) {
        updateLink(links[i]);
      }
    }

    cssTimeout = null;
  }, 50);
}

// Loads an update as a script from a blob URL, so that stack traces have line numbers and devtools
// apply its source map. Returns null if there's no way to load a script, in which case it is
// evaluated instead.
function hmrDownload(asset) {
  if (asset.type !== 'js') {
    return null;
  }

  if (typeof document !== 'undefined' && document.head) {
    let url = URL.createObjectURL(
      new Blob([asset.output], {type: 'text/javascript'}),
    );
    let script = document.createElement('script');
    script.src = url;
    return new Promise((resolve, reject) => {
      script.onload = () => {
        URL.revokeObjectURL(url);
        resolve(script);
      };
      script.onerror = err => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      document.head.appendChild(script);
    });
  } else if (typeof importScripts === 'function') {
    // Worker scripts
    let url = URL.createObjectURL(
      new Blob([asset.output], {type: 'text/javascript'}),
    );
    // Module workers don't support importScripts.
    let load =
      asset.outputFormat === 'esmodule'
        ? import(url)
        : new Promise(resolve => {
            importScripts(url);
            resolve();
          });
    // There's no script to remove afterward.
    return load.then(
      () => {
        URL.revokeObjectURL(url);
        return null;
      },
      err => {
        URL.revokeObjectURL(url);
        throw err;
      },
    );
  }

  return null;
}

async function hmrApplyUpdates(assets) {
  globalThis.parcelHotUpdate = Object.create(null);

  let scriptsToRemove;
  try {
    // If sourceURL comments aren't supported in eval, we need to load
    // the update as a script so that stack traces are correct in
    // errors/logs. This is slower than eval, so we only do it if
    // needed (currently just Safari).
    // https://bugs.webkit.org/show_bug.cgi?id=137297
    // This path is also taken if a CSP disallows eval.
    if (!supportsSourceURL) {
      let promises = assets.map(asset =>
        hmrDownload(asset)?.catch(err => {
          // Web extension fix
          if (
            extCtx &&
            extCtx.runtime &&
            extCtx.runtime.getManifest().manifest_version == 3 &&
            typeof ServiceWorkerGlobalScope != 'undefined' &&
            globalThis instanceof ServiceWorkerGlobalScope
          ) {
            extCtx.runtime.reload();
            return;
          }
          throw err;
        }),
      );

      scriptsToRemove = await Promise.all(promises);
    }

    assets.forEach(function (asset) {
      hmrApply(parcelRequire.root, asset);
    });
  } finally {
    delete globalThis.parcelHotUpdate;

    if (scriptsToRemove) {
      scriptsToRemove.forEach(script => {
        if (script) {
          document.head?.removeChild(script);
        }
      });
    }
  }
}

function hmrApply(bundle /*: ParcelRequire */, asset /*:  HMRAsset */) {
  var modules = bundle.modules;
  if (!modules) {
    return;
  }

  if (asset.type === 'css') {
    reloadCSS();
  } else if (asset.type === 'js') {
    let deps = asset.depsByBundle[bundle.HMR_BUNDLE_ID];
    if (deps) {
      if (modules[asset.id]) {
        // Remove dependencies that are removed and will become orphaned.
        // This is necessary so that if the asset is added back again, the cache is gone, and we prevent a full page reload.
        let oldDeps = modules[asset.id][1];
        for (let dep in oldDeps) {
          if (!deps[dep] || deps[dep] !== oldDeps[dep]) {
            let id = oldDeps[dep];
            let parents = getParents(parcelRequire.root, id);
            if (parents.length === 1) {
              hmrDelete(parcelRequire.root, id);
            }
          }
        }
      }

      // Updates that weren't loaded as scripts are evaluated, once for all bundles.
      if (!globalThis.parcelHotUpdate[asset.id]) {
        // Global eval. We would use `new Function` here but browser
        // support for source maps is better with eval.
        (0, eval)(asset.output);
      }

      // $FlowFixMe
      let fn = globalThis.parcelHotUpdate[asset.id];
      modules[asset.id] = [fn, deps];
    }

    // Always traverse to the parent bundle, even if we already replaced the asset in this bundle.
    // This is required in case modules are duplicated. We need to ensure all instances have the updated code.
    if (bundle.parent) {
      hmrApply(bundle.parent, asset);
    }
  }
}

function hmrDelete(bundle, id) {
  let modules = bundle.modules;
  if (!modules) {
    return;
  }

  if (modules[id]) {
    // Collect dependencies that will become orphaned when this module is deleted.
    let deps = modules[id][1];
    let orphans = [];
    for (let dep in deps) {
      let parents = getParents(parcelRequire.root, deps[dep]);
      if (parents.length === 1) {
        orphans.push(deps[dep]);
      }
    }

    // Delete the module. This must be done before deleting dependencies in case of circular dependencies.
    delete modules[id];
    delete bundle.cache[id];

    // Now delete the orphans.
    orphans.forEach(id => {
      hmrDelete(parcelRequire.root, id);
    });
  } else if (bundle.parent) {
    hmrDelete(bundle.parent, id);
  }
}

function hmrAcceptCheck(
  bundle /*: ParcelRequire */,
  id /*: string */,
  depsByBundle /*: ?{ [string]: { [string]: string } }*/,
) {
  checkedAssets = {};
  if (hmrAcceptCheckOne(bundle, id, depsByBundle)) {
    return true;
  }

  // Traverse parents breadth first. All possible ancestries must accept the HMR update, or we'll reload.
  // Each entry is a parent's bundle and id, and the bundle and id of the child it was reached from.
  let parents = getParents(parcelRequire.root, id).map(p => [
    p[0],
    p[1],
    bundle,
    id,
  ]);
  let accepted = false;
  while (parents.length > 0) {
    let [parentBundle, parentId, childBundle, childId] = parents.shift();
    let a =
      hmrAcceptsDependency(parentBundle, parentId, childBundle, childId) ||
      hmrAcceptCheckOne(parentBundle, parentId, null);
    if (a) {
      // If this parent accepts, stop traversing upward, but still consider siblings.
      accepted = true;
    } else if (a !== null) {
      // Otherwise, queue the parents in the next level upward.
      let p = getParents(parcelRequire.root, parentId);
      if (p.length === 0) {
        // If there are no parents, then we've reached an entry without accepting. Reload.
        accepted = false;
        break;
      }
      parents.push(...p.map(q => [q[0], q[1], parentBundle, parentId]));
    }
  }

  return accepted;
}

// Whether the parent accepts updates to the child. If so, the child is re-run, but the parent isn't.
function hmrAcceptsDependency(
  parentBundle /*: ParcelRequire */,
  parentId /*: string */,
  childBundle /*: ParcelRequire */,
  childId /*: string */,
) {
  var cached = parentBundle.cache[parentId];
  if (cached && cached.hot && cached.hot._acceptedDependencies[childId]) {
    assetsToAccept.push([childBundle, childId]);
    dependenciesToAccept.push([parentBundle, parentId, childId]);
    return true;
  }

  return false;
}

// Calls each callback for accepted dependency updates once, with the ids of the updated dependencies.
function hmrAcceptDependencies() {
  let calls = new Map();
  for (let [bundle, parentId, childId] of dependenciesToAccept) {
    let cached = bundle.cache[parentId];
    let callbacks = cached && cached.hot._acceptedDependencies[childId];
    for (let callback of callbacks || []) {
      let ids = calls.get(callback);
      if (!ids) {
        calls.set(callback, (ids = []));
      }
      if (!ids.includes(childId)) {
        ids.push(childId);
      }
    }
  }
  dependenciesToAccept = [];
  calls.forEach((ids, callback) => callback(ids));
}

function hmrAcceptCheckOne(
  bundle /*: ParcelRequire */,
  id /*: string */,
  depsByBundle /*: ?{ [string]: { [string]: string } }*/,
) {
  var modules = bundle.modules;
  if (!modules) {
    return;
  }

  if (depsByBundle && !depsByBundle[bundle.HMR_BUNDLE_ID]) {
    // If we reached the root bundle without finding where the asset should go,
    // there's nothing to do. Mark as "accepted" so we don't reload the page.
    if (!bundle.parent) {
      return true;
    }

    return hmrAcceptCheckOne(bundle.parent, id, depsByBundle);
  }

  if (checkedAssets[id]) {
    return null;
  }

  checkedAssets[id] = true;

  var cached = bundle.cache[id];
  if (!cached) {
    return true;
  }

  assetsToDispose.push([bundle, id]);

  if (cached && cached.hot && cached.hot._acceptCallbacks.length) {
    assetsToAccept.push([bundle, id]);
    return true;
  }

  return false;
}

function hmrDisposeQueue() {
  // Dispose all old assets.
  for (let i = 0; i < assetsToDispose.length; i++) {
    let id = assetsToDispose[i][1];

    if (!disposedAssets[id]) {
      hmrDispose(assetsToDispose[i][0], id);
      disposedAssets[id] = true;
    }
  }

  assetsToDispose = [];
}

function hmrDispose(bundle /*: ParcelRequire */, id /*: string */) {
  var cached = bundle.cache[id];
  bundle.hotData[id] = {};
  if (cached && cached.hot) {
    cached.hot.data = bundle.hotData[id];
  }

  if (cached && cached.hot && cached.hot._disposeCallbacks.length) {
    cached.hot._disposeCallbacks.forEach(function (cb) {
      cb(bundle.hotData[id]);
    });
  }

  if (cached && cached.exports === cached._ownExports) {
    bundle.hotExports[id] = cached.exports;
  }
  delete bundle.cache[id];
}

function hmrAccept(bundle /*: ParcelRequire */, id /*: string */) {
  // Execute the module. Re-evaluating a module that evaluates asynchronously (it uses top-level
  // await, or imports a module that does) isn't supported.
  try {
    bundle(id);
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ASYNC_MODULE') {
      return fullReload();
    }
    throw err;
  }

  // Run the accept callbacks in the new version of the module.
  var cached = bundle.cache[id];
  if (cached && cached.hot && cached.hot._acceptCallbacks.length) {
    let assetsToAlsoAccept = [];
    cached.hot._acceptCallbacks.forEach(function (cb) {
      let additionalAssets = cb(function () {
        return getParents(parcelRequire.root, id);
      });
      if (Array.isArray(additionalAssets) && additionalAssets.length) {
        assetsToAlsoAccept.push(...additionalAssets);
      }
    });

    if (assetsToAlsoAccept.length) {
      let handled = assetsToAlsoAccept.every(function (a) {
        return hmrAcceptCheck(a[0], a[1]);
      });

      if (!handled) {
        return fullReload();
      }

      hmrDisposeQueue();
    }
  }
}
