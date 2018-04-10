var b = import('./b');

export default b.then(function ({foo, bar}) {
  return foo + bar;
});
