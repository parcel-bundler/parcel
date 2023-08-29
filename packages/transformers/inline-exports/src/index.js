const {Transformer} = require('@parcel/plugin');
const {transformFunc} = require('./transformFunc');

module.exports = new Transformer({
  transform: transformFunc,
});
