module.exports = process.env.PARCEL_DEV
  ? require('babel-register') && require('./src/Parcel').default
  : require('./lib/Parcel');
