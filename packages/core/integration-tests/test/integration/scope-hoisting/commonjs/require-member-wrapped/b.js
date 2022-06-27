module.exports = function (self) {
  return require('./c').bind(self)
};
