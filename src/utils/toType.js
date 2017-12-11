module.exports = function(obj) {
  const toString = Object.prototype.toString;
  const type = toString
    .call(obj)
    .replace(/[\[\]]/g, '')
    .split(/\s/)[1];
  return type.toLowerCase();
};
