export function eager() {
  return require('./value');
}
globalThis.output = async () => {
  let synchronous = true;
  const pending = import('./value').then(m => [synchronous, m.value]);
  synchronous = false;
  sideEffect('after-import');
  return pending;
};
