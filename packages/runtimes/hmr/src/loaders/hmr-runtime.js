// @flow
/* global HMR_HOST, HMR_PORT, HMR_ENV_HASH */

/*::
import type {HMRAsset, HMRMessage} from '@parcel/reporter-dev-server/src/HMRServer.js';
interface ParcelRequire {
  (string): mixed;
  cache: {|[string]: ParcelModule|};
  hotData: mixed;
  Module: any;
  parent: ?ParcelRequire;
  isParcelRequire: true;
  modules: {|[string]: [Function, {|[string]: string|}]|};
  HMR_BUNDLE_ID: string;
}

interface ParcelModule {
  hot: {|
    data: mixed;
    _acceptSelfCallbacks: Array<(Function) => void>,
    _acceptDepCallbacks: {|[string]: Array<() => void>|},
    _disposeCallbacks: Array<(mixed) => void>,

    accept(deps: Array<string> | string, cb: (Function) => void): void,
    accept(cb: (Function) => void): void,
    dispose(cb: (mixed) => void): void,
    decline(): void,
  |};
}

declare var module: {bundle: ParcelRequire, ...};
declare var HMR_HOST: string;
declare var HMR_PORT: string;
declare var HMR_ENV_HASH: string;
*/

var OVERLAY_ID = '__parcel__error__overlay__';

var OldModule = module.bundle.Module;

function Module(moduleName) {
  OldModule.call(this, moduleName);
  this.hot = {
    data: module.bundle.hotData,
    _acceptSelfCallbacks: [],
    _acceptDepCallbacks: {},
    _disposeCallbacks: [],
    accept: function(deps, cb) {
      if (!cb) {
        this._acceptSelfCallbacks.push(deps || function() {});
      } else {
        [].concat(deps).forEach(d => {
          let list = this._acceptDepCallbacks[d];
          if (!list) {
            list = [];
            this._acceptDepCallbacks[d] = list;
          }
          list.push(cb || function() {});
        });
      }
    },
    dispose: function(fn) {
      this._disposeCallbacks.push(fn);
    },
  };

  module.bundle.hotData = null;
}

module.bundle.Module = Module;
var checkedAssets: {|[string]: boolean|},
  acceptedAssets: {|[string]: boolean|},
  assetsToAccept: Array<[ParcelRequire, string]>;

// eslint-disable-next-line no-redeclare
var parent = module.bundle.parent;
if ((!parent || !parent.isParcelRequire) && typeof WebSocket !== 'undefined') {
  var hostname =
    HMR_HOST ||
    (location.protocol.indexOf('http') === 0 ? location.hostname : 'localhost');
  var port = HMR_PORT || location.port;
  var protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  var ws = new WebSocket(
    protocol + '://' + hostname + (port ? ':' + port : '') + '/',
  );
  // $FlowFixMe
  ws.onmessage = function(event: {data: string, ...}) {
    checkedAssets = ({}: {|[string]: boolean|});
    acceptedAssets = ({}: {|[string]: boolean|});
    assetsToAccept = [];

    var data: HMRMessage = JSON.parse(event.data);

    if (data.type === 'update') {
      // Remove error overlay if there is one
      removeErrorOverlay();

      let assets = data.assets.filter(asset => asset.envHash === HMR_ENV_HASH);

      // Handle HMR Update
      var handled = false;
      assets.forEach(asset => {
        var didAccept =
          asset.type === 'css' ||
          hmrAcceptCheck(
            global.parcelRequire,
            asset.id,
            global.parcelRequire,
            asset.id,
          );
        if (didAccept) {
          handled = true;
        }
      });

      if (handled) {
        console.clear();

        assets.forEach(function(asset) {
          hmrApply(global.parcelRequire, asset);
        });

        for (var i = 0; i < assetsToAccept.length; i++) {
          var id = assetsToAccept[i][1];
          if (!acceptedAssets[id]) {
            hmrAcceptRun(assetsToAccept[i][0], id);
          }
        }
      } else {
        window.location.reload();
      }
    } else if (data.type === 'error') {
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

      // Render the fancy html overlay
      removeErrorOverlay();
      var overlay = createErrorOverlay(data.diagnostics.html);
      // $FlowFixMe
      document.body.appendChild(overlay);
    }
  };
  ws.onerror = function(e) {
    console.error(e.message);
  };
  ws.onclose = function(e) {
    console.warn('[parcel] 🚨 Connection to the HMR server was lost');
  };
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

  diagnostics.forEach(diagnostic => {
    let stack = diagnostic.codeframe ? diagnostic.codeframe : diagnostic.stack;

    errorHTML += `
      <div>
        <div style="font-size: 18px; font-weight: bold; margin-top: 20px;">
          🚨 ${diagnostic.message}
        </div>
        <pre>
          ${stack}
        </pre>
        <div>
          ${diagnostic.hints.map(hint => '<div>' + hint + '</div>').join('')}
        </div>
      </div>
    `;
  });

  errorHTML += '</div>';

  overlay.innerHTML = errorHTML;

  return overlay;
}

function getParents(
  bundle: ParcelRequire,
  id: string,
): Array<[ParcelRequire, string]> {
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
  var newLink = link.cloneNode();
  newLink.onload = function() {
    if (link.parentNode != null) {
      link.parentNode.removeChild(link);
    }
  };
  newLink.setAttribute(
    'href',
    // $FlowFixMe
    link.getAttribute('href').split('?')[0] + '?' + Date.now(),
  );
  // $FlowFixMe
  link.parentNode.insertBefore(newLink, link.nextSibling);
}

var cssTimeout = null;
function reloadCSS() {
  if (cssTimeout) {
    return;
  }

  cssTimeout = setTimeout(function() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      var absolute =
        // $FlowFixMe
        /^https?:\/\//i.test(href) &&
        // $FlowFixMe
        href.indexOf(window.location.origin) !== 0;
      if (!absolute) {
        updateLink(links[i]);
      }
    }

    cssTimeout = null;
  }, 50);
}

function hmrApply(bundle: ParcelRequire, asset: HMRAsset) {
  var modules = bundle.modules;
  if (!modules) {
    return;
  }

  if (modules[asset.id] || !bundle.parent) {
    if (asset.type === 'css') {
      reloadCSS();
    } else {
      var fn = new Function('require', 'module', 'exports', asset.output);
      modules[asset.id] = [fn, asset.depsByBundle[bundle.HMR_BUNDLE_ID]];
    }
  } else if (bundle.parent) {
    hmrApply(bundle.parent, asset);
  }
}

function hmrAcceptCheck(
  bundle: ParcelRequire,
  id: string,
  depBundle: ParcelRequire,
  dep: string,
) {
  var modules = bundle.modules;

  if (!modules) {
    return;
  }

  if (!modules[id] && bundle.parent) {
    return hmrAcceptCheck(bundle.parent, id, bundle, id);
  }

  if (checkedAssets[id]) {
    return;
  }

  checkedAssets[id] = true;

  var cached = bundle.cache[id];

  if (cached && cached.hot && cached.hot._acceptSelfCallbacks.length) {
    assetsToAccept.push([bundle, id]);
    return true;
  }

  var deps = bundle.modules[id][1];
  var depSpecifier;
  for (let i in deps) {
    if (deps[i] === dep) {
      depSpecifier = i;
      break;
    }
  }
  if (
    depSpecifier &&
    cached &&
    cached.hot &&
    depSpecifier in cached.hot._acceptDepCallbacks
  ) {
    assetsToAccept.push([depBundle, dep]);
    return true;
  }

  return getParents(global.parcelRequire, id).some(function(v) {
    return hmrAcceptCheck(v[0], v[1], bundle, id);
  });
}

function hmrAcceptRun(bundle: ParcelRequire, id: string) {
  var cached = bundle.cache[id];
  bundle.hotData = {};
  if (cached && cached.hot) {
    cached.hot.data = bundle.hotData;
  }

  if (cached && cached.hot && cached.hot._disposeCallbacks.length) {
    cached.hot._disposeCallbacks.forEach(function(cb) {
      cb(bundle.hotData);
    });
  }

  // TODO this recreates `module.exports` instead of mutating it, so the imports
  // in parents aren't updated automatically
  delete bundle.cache[id];
  bundle(id);

  cached = bundle.cache[id];

  if (cached && cached.hot && cached.hot._acceptSelfCallbacks.length) {
    cached.hot._acceptSelfCallbacks.forEach(function(cb) {
      var assetsToAlsoAccept = cb(function() {
        return getParents(global.parcelRequire, id);
      });
      if (assetsToAlsoAccept && assetsToAccept.length) {
        assetsToAccept.push.apply(assetsToAccept, assetsToAlsoAccept);
      }
    });
  } else {
    var parents = getParents(global.parcelRequire, id);
    parents.forEach(parent => {
      var parentDeps = parent[0].modules[parent[1]][1];
      var depSpecifier;
      for (let i in parentDeps) {
        if (parentDeps[i] === id) {
          depSpecifier = i;
          break;
        }
      }
      let parentModule = parent[0].cache[parent[1]];
      if (
        depSpecifier &&
        parentModule &&
        parentModule.hot &&
        depSpecifier in parentModule.hot._acceptDepCallbacks
      ) {
        parentModule.hot._acceptDepCallbacks[depSpecifier].forEach(function(
          cb,
        ) {
          cb();
        });
      }
    });
  }

  acceptedAssets[id] = true;
}
