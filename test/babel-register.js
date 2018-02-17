if (process.version.match(/^v(\d+)\.\d+\.\d+$/)[1] < 8) {
  require('babel-register');
}
