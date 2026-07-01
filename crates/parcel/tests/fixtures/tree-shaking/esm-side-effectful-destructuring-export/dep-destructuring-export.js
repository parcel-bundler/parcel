export const usedDestructuringValue = 'used-destructuring-export';

export const {unusedDestructuredValue} = sideEffectNoop({
  unusedDestructuredValue: sideEffect('unused-destructuring-export')
});

export const unusedPureValue = 'unused-destructuring-pure-sentinel';
