sideEffect('value before');
export const value = await Promise.resolve('v');
sideEffect('value after');
