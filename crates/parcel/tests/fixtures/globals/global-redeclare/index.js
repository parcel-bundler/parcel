const global = {};
module.exports = function () {
  return !!global.document;
};
