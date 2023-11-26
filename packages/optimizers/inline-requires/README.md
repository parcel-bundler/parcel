# EXPERIMENTAL inline requires plugin

This plugin is currently **experimental** / unstable, however that said it has been used in a very large web application with great success in reducing runtime startup time of the application.

## Quick usage

Add this optimizer to run _first_ (before minification), for JS bundles.

```json
{
    "optimizers": {
        "*.js": {
            "parcel-optimizer-inline-requires",
            "..."
        }
    }
}
```

## Background and motivation

When Parcel produces modules in bundles, where a dependency wasn't brought in by scope hoisting, it includes calls to require those dependencies at the top of the module function. For example, prior to minification, a module might look something like this:

```js
parcelRegister('abc123', function (require, module, exports) {
  var $def456 = require('def456');
  var $ghi789 = require('ghi789');

  exports.someFunction = function () {
    if ($def456.someOperation()) {
      return $ghi789.anotherOperation();
    }
    return null;
  };
});
```

When the module is first initialised (i.e. the "module factory" is called), this will get the `def456` and `ghi789` modules, immediately calling their module factories, and so on down. However, the two modules don't have any of their code called until the `someFunction` export is called. If, for example, the call site looks like this:

```js
// other code..
var $abc123 = require('abc123');
element.addEventListener('click', () => {
  element.innerText = $abc123.someFunction();
});
```

.. then the code in `abc123` might not be called until much later, or never at all. In a large enough application, the evaluation / execution time of all these factory functions can be noticeable in performance metrics for the application.

What this plugin does, is it turns those `require` calls into "lazy" or "deferred" evaluation requires - that is, the factory function will only be executed when the module is first used. For the first example, the resulting code (pre-minification) will look like this:

```js
parcelRegister('abc123', function (require, module, exports) {
  var $def456;
  var $ghi789;

  exports.someFunction = function () {
    if ((0, require('def456')).someOperation()) {
      return (0, require('ghi789')).anotherOperation();
    }
    return null;
  };
});
```

The minifier will remove the uninitialised variables, and it will also simplify the `(0, ...)` sequence expressions where possible.

It is important to note, that Parcel will only execute the factory function once. Subseqent calls to `require` will return the module as returned from the original factory. See the `require` code in `packages/packagers/js/src/helpers.js` for how this works.

## Caveats

### Overhead

So the main caveat here is that we're now turning a simple variable access into a function call everytime the module is referenced. For smaller applications, this overhead may not be worth the tradeoff, however for larger applications it might. That's why this plugin is optional, as you need to try it to determine whether or not it works for you.

### Side-effects

A module may have side-effects when it is initialised (e.g. setting an event handler on the `window` for example). For assets that Parcel has identified as having side-effects (whether through `package.json` `sideEffects` field, or other heuristics), these modules will _not_ have their `require` calls deferred.
