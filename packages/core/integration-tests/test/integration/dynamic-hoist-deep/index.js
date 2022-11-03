export default Promise.all([
  import('./a'),
  import('./b')
]).then(([a, b]) => {
  return Promise.all([a.default, b.default])
}).then(([v1, v2]) => {
  return v1.default === v2.default;
});
