sideEffect(typeof require.cache);
sideEffect(Object.keys(require.cache).length > 0);
module.exports = typeof require.cache;
