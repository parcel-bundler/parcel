const babylon = require('babylon');

module.exports = function (code, opts) {
  const options = {
    filename: opts.filename,
    allowImportExportEverywhere: opts.loose,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
    ecmaVersion: Infinity,
    strictMode: false,
    sourceType: 'module',
    locations: true,
    features: opts.features || {},
    plugins: opts.plugins || [
      'asyncFunctions',
      'asyncGenerators',
      'classConstructorCall',
      'classProperties',
      'decorators',
      'exportExtensions',
      'jsx',
      'flow'
    ]
  };

  return babylon.parse(code, options);
};
