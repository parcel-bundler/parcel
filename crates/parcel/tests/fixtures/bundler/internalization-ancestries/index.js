module.exports = async () => {
  const a = await import('./a');
  const b = await import('./b');
  return [await a(), await b()];
};
