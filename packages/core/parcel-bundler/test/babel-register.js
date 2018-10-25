if (parseInt(process.versions.node, 10) < 8) {
  const config = require('./.babelrc');
  require('@babel/register')({
    ignore: [filepath => filepath.includes('/node_modules/'), ...config.ignore],
    presets: config.presets,
    plugins: config.plugins
  });
}
