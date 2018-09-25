module.exports = doFoo
  
function doFoo() {
  return foo
}

if(process.env.NODE_ENV === 'test') {
  var foo = 'bar'
}
else {
  foo = 'foo'
}
