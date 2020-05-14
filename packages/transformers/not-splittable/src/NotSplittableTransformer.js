const {Transformer} = require('@parcel/plugin');

exports.default = new Transformer({
  transform({asset}) {
    asset.isSplittable = false;
    return [asset];
  },
});
