export function eager() {
  return require('./throws');
}
globalThis.output = async () => {
  let synchronous = true;
  const pending = import('./throws').catch(error => [
    synchronous,
    error.message,
  ]);
  synchronous = false;
  return pending;
};
