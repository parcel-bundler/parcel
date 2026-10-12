var unusedGlobal = 'still a global';
function exposedGlobal(someArgument) {
  var someLocalVariable = someArgument + ' ' + unusedGlobal;
  return someLocalVariable;
}
