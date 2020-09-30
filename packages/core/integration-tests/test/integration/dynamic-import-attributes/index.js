export default Promise.all([
  import('./async', {foo: {}}),
  import('./async2', {foo: {}, assert: {type: 'js'}}),
]);
