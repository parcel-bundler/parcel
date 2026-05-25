export default () => {
  try {
    return require('fs').readFileSync(__dirname + '/package.json');
  }
  catch(_) {
    return 'test-pkg-ignore-fs-ok';
  }
}
