sideEffect('async before');
export const value = await Promise.resolve('a');
sideEffect('async after');
