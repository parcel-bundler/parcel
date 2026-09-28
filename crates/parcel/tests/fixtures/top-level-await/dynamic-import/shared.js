sideEffect('shared before');
export const value = await Promise.resolve('s');
sideEffect('shared after');
