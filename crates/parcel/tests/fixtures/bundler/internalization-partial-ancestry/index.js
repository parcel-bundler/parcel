module.exports = async () => {
  const b = await import('./b');
  const result = await b();
  const a = await import('./a');
  return [result, await a()];
};
