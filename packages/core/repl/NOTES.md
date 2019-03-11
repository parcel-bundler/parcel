### Needed Changes for self-hosting

- change `process.browser` and `env` visitor to also remove other if case completely (to remove unused branches with `require`s) -> #2650
- sourcemap only at end: #2427
- (scope hoisting destructuring: #2742)

Building with scope hoisting or source maps results in an Out of Memory crash

### Scope Hoisting doesn't work / requiring node modules like `path` doesn't work

```
parcel/packages/core/parcel-bundler/src/builtins/index.js:
    node-libs-browser:
        require.resolve()
```

`require.resolve` should return module id that can be required?

- naive attempt breaks dynamic import

### Other

Connecting with Chrome Devtools to Chrome on Android silently prevents the execution of Web Workers

### Other TODOs

- use cache (Markdown isn't updating if enabled)
- with cache, maybe even a watcher-like functionality (on state change with debouncing)
