// Awaited in sequence: `Promise.all([import(), import()])` would make left and
// right one loading root, and this fixture needs two independent ancestries.
module.exports = async () => {
  const left = await import('./left');
  const right = await import('./right');
  return Promise.all([left.run(), right.run()]);
};
