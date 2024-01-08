const {Resolver} = require('@parcel/plugin');

module.exports = new Resolver({
  resolve({specifier}) {
    if (specifier === './foo') {
      return {
        filePath: __dirname + '/foo.js',
        priority: 'parallel'
      };
    }
  }
});
