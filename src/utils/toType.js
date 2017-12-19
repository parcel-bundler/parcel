const toString = Object.prototype.toString;

module.exports = function(obj) {
  const type = toString.call(obj).slice(8, -1);
  return type.toLowerCase();
};
