export default () => {
  try {
    // We expect browser-resolve to replace fs with an empty module, so readFileSync will be undefined
    return require('fs').readFileSync(__dirname + '/package.json')
  }
  catch(_) {
    return 'test-pkg-ignore-fs-ok'
  }
}
