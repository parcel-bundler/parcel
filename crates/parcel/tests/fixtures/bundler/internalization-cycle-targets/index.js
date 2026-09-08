module.exports = async () => {
  const b = await import('./b');
  const a = await import('./a');
  return [a.name, b.name, a.other(), b.other()];
};
