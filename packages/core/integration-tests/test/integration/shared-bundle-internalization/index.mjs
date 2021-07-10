export default Promise.all([
  import("./a.mjs").then(m => m.default),
  import("./b.mjs").then(m => m.default),
]);
