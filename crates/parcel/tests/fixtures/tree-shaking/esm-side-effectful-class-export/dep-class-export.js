export const usedClassValue = 'used-class-export';

export function unusedFunctionDeclaration() {
  return 'unused-function-declaration-sentinel';
}

export const unusedClassExpression = class {
  [sideEffect('unused-class-computed-key')]() {}
};
