/* global module */
// Evaluates ES modules that contain top-level await, or statically import one, following the
// spec's algorithm (ECMA-262 16.2.1.5.3: Evaluate, InnerModuleEvaluation, ExecuteAsyncModule,
// GatherAvailableAncestors, AsyncModuleExecutionFulfilled/Rejected).
//
// The packager emits these "async" modules as a single async function, entered when the module is
// first required, like webpack's async modules:
//
//   require('_tla').enter(module, imports, hasTLA, async function (g) {
//     try {
//       <its exports, then requires of its static imports>
//       var w = g(); if (w) (await w)();
//       <the rest of its body>
//       g.d();
//     } catch (e) { g.c(e); }
//   });
//
// Its requires evaluate its imports in order (entering async ones), much like linking does, so its
// bindings are usable from cycles before its body runs. `g()` then completes InnerModuleEvaluation.
// The body only waits (in `await w`) while an import is still evaluating asynchronously; otherwise it
// runs right away, synchronously unless it awaits itself. Every other module is evaluated by
// `require` in place, as usual. None of those can reach an async module, so that is equivalent to the
// spec's algorithm.
//
// This module is shared by every bundle through the require cache, so its state is too. It exports a
// function that evaluates a module and resolves to its exports, for dynamic imports and entries.

var parcelRequire = module.bundle;
var cache = parcelRequire.cache;
var asyncEvaluationCount = 1;
// The synchronous depth-first traversal in progress, if any.
var traversal = null;
// Capabilities of modules being evaluated for the first time, until they are entered.
var capabilities = {};
// Synchronous modules that will resume in a microtask (see `fulfilled`).
var pendingResumes = 0;

function evaluate(id) {
  // The spec never evaluates a module while another evaluation is in progress: dynamic imports
  // finish loading in a later job. A module body can still start one synchronously here, e.g. by
  // loading a CommonJS bundle whose entry is async, so defer it.
  if (traversal || pendingResumes) {
    return Promise.resolve().then(function () {
      return evaluate(id);
    });
  }

  var module = cache[id];
  var capability;
  if (!module) {
    capability = capabilities[id] = newCapability();
    traversal = {stack: [], index: 0};
    try {
      parcelRequire(id);
      module = cache[id];
      // Externals have no record.
      if (!module || !(module.asyncEvaluation > 0)) {
        capability.resolve();
      }
    } catch (err) {
      for (var i = 0; i < traversal.stack.length; i++) {
        var m = traversal.stack[i];
        m.status = 'evaluated';
        m.error = {value: err};
        // Errored modules are never popped off the stack as a cycle, so they are their own root.
        m.cycleRoot = m;
      }
      capability.reject(err);
    } finally {
      traversal = null;
      delete capabilities[id];
    }
    return capability.promise;
  }

  // Not an async module, so requiring it evaluated it.
  if (!module.cycleRoot) {
    return Promise.resolve();
  }
  module = module.cycleRoot;
  if (module.capability) {
    return module.capability.promise;
  }
  capability = module.capability = newCapability();
  if (module.error) {
    capability.reject(module.error.value);
  } else if (!(module.asyncEvaluation > 0)) {
    capability.resolve();
  }
  return capability.promise;
}

// InnerModuleEvaluation, for an async module being required for the first time.
function enter(module, imports, hasTLA, fn) {
  if (!traversal) {
    var err = new Error(
      "Cannot require() '" +
        module.id +
        "' because it uses top-level await, or imports a module that does.",
    );
    err.code = 'ERR_REQUIRE_ASYNC_MODULE';
    throw err;
  }

  module.imports = imports;
  module.hasTLA = hasTLA;
  module.status = 'evaluating';
  module.dfsIndex = module.dfsAncestorIndex = traversal.index++;
  module.pendingAsyncDependencies = 0;
  module.asyncParentModules = [];
  module.phase = 'link';
  if (capabilities[module.id]) {
    module.capability = capabilities[module.id];
  }
  traversal.stack.push(module);

  var g = function () {
    return link(module);
  };
  g.d = function () {
    done(module);
  };
  g.c = function (err) {
    fail(module, err);
  };
  module.entering = true;
  fn.call(module.exports, g);
  module.entering = false;
  if (module.syncError) {
    var error = module.syncError.value;
    module.syncError = null;
    throw error;
  }

  if (module.dfsAncestorIndex === module.dfsIndex) {
    var popped = false;
    while (!popped) {
      var m = traversal.stack.pop();
      m.status = m.asyncEvaluation > 0 ? 'evaluating-async' : 'evaluated';
      m.cycleRoot = module;
      popped = m === module;
    }
  }
}

// The rest of InnerModuleEvaluation, once the module's requires have visited its imports. Returns a
// promise if it must wait for them, which resolves to a function to call once it resumes.
function link(module) {
  var imports = module.imports;
  var i;
  // Imports that weren't required yet, e.g. re-exports that are resolved lazily.
  for (i = 0; i < imports.length; i++) {
    parcelRequire(imports[i]);
  }
  for (i = 0; i < imports.length; i++) {
    var required = cache[imports[i]];
    // Not an async module.
    if (!required || !required.imports) {
      continue;
    }
    if (required.status === 'evaluating') {
      module.dfsAncestorIndex = Math.min(
        module.dfsAncestorIndex,
        required.dfsAncestorIndex,
      );
    } else {
      required = required.cycleRoot;
      if (required.error) {
        throw required.error.value;
      }
    }
    if (required.asyncEvaluation > 0) {
      module.pendingAsyncDependencies++;
      required.asyncParentModules.push(module);
    }
  }

  if (module.pendingAsyncDependencies > 0 || module.hasTLA) {
    // The order modules become async in is the order waiting ancestors run in.
    module.asyncEvaluation = asyncEvaluationCount++;
  }
  if (module.pendingAsyncDependencies === 0) {
    // ExecuteAsyncModule or ExecuteModule: the body runs now.
    module.phase = module.hasTLA ? 'async' : 'sync';
    return null;
  }
  module.phase = 'waiting';
  return new Promise(function (resolve) {
    module.resume = resolve;
  });
}

function done(module) {
  if (module.phase === 'async') {
    // A body that completes while it's entered finishes a job later, like the spec's reaction to
    // the async module execution. Otherwise, like webpack, finish now: its ancestors each resume in
    // a microtask of their own (see `fulfilled`), which together take the place of that job.
    if (module.entering) {
      later(fulfilled, module);
    } else {
      fulfilled(module, true);
    }
  } else if (module.phase === 'resumed') {
    module.asyncEvaluation = -1;
    module.status = 'evaluated';
    if (module.capability) {
      module.capability.resolve();
    }
  }
}

function fail(module, err) {
  if (module.phase === 'async') {
    if (module.entering) {
      later(rejected, module, err);
    } else {
      rejected(module, err, true);
    }
  } else if (module.phase === 'resumed') {
    // Like ExecuteModule failing within AsyncModuleExecutionFulfilled.
    rejected(module, err);
  } else {
    // Linking or a synchronous body failed: abort the traversal, from `enter`.
    module.syncError = {value: err};
  }
}

function gatherAvailableAncestors(module, execList) {
  for (var i = 0; i < module.asyncParentModules.length; i++) {
    var m = module.asyncParentModules[i];
    if (execList.indexOf(m) < 0 && !m.cycleRoot.error) {
      if (--m.pendingAsyncDependencies === 0) {
        execList.push(m);
        if (!m.hasTLA) {
          gatherAvailableAncestors(m, execList);
        }
      }
    }
  }
}

function fulfilled(module, early) {
  if (module.status === 'evaluated') {
    // Already rejected via another dependency.
    return;
  }
  module.asyncEvaluation = -1;
  module.status = 'evaluated';
  if (module.capability) {
    settle(module.capability.resolve, undefined, early);
  }

  var execList = [];
  gatherAvailableAncestors(module, execList);
  execList.sort(function (a, b) {
    return a.asyncEvaluation - b.asyncEvaluation;
  });

  // Every ancestor this unblocks resumes in the order they became async. Each continues in its own
  // microtask, all queued now, so they run back to back before anything their bodies queue.
  for (var i = 0; i < execList.length; i++) {
    var m = execList[i];
    if (m.status !== 'evaluated') {
      if (!m.hasTLA) {
        pendingResumes++;
      }
      m.resume(resume.bind(null, m));
    }
  }
}

function resume(module) {
  // The rest of a synchronous body runs within this microtask.
  if (!module.hasTLA) {
    pendingResumes--;
  }
  module.phase = module.hasTLA ? 'async' : 'resumed';
  // Rejected via another dependency since.
  if (module.status === 'evaluated') {
    throw module.error.value;
  }
}

function rejected(module, err, early) {
  if (module.status === 'evaluated') {
    return;
  }
  module.error = {value: err};
  module.status = 'evaluated';
  module.asyncEvaluation = -1;
  // Settle this module before its ancestors, like fulfillment does.
  if (module.capability) {
    settle(module.capability.reject, err, early);
  }
  for (var i = 0; i < module.asyncParentModules.length; i++) {
    rejected(module.asyncParentModules[i], err, early);
  }
}

// Settles a capability, a job later when settling a job early.
function settle(fn, value, early) {
  if (early) {
    later(fn, value);
  } else {
    fn(value);
  }
}

function later(fn, a, b) {
  Promise.resolve().then(function () {
    fn(a, b);
  });
}

function newCapability() {
  var capability = {};
  capability.promise = new Promise(function (resolve, reject) {
    capability.resolve = resolve;
    capability.reject = reject;
  });
  return capability;
}

module.exports = function (id) {
  return evaluate(id).then(function () {
    return parcelRequire(id);
  });
};
module.exports.enter = enter;
