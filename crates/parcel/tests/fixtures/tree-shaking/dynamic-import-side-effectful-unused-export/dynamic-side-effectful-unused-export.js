output = import('./async-side-effectful-unused-export.js').then(
  ({usedDynamicSideEffect}) => {
    sideEffect(usedDynamicSideEffect);
    return usedDynamicSideEffect;
  }
);
