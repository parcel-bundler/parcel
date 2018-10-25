const parcelBabelPreset = require('@parcel/babel-preset');

require('@babel/register')({
  ignore: [filepath => filepath.includes('/node_modules/')],
  presets: [parcelBabelPreset]
});
