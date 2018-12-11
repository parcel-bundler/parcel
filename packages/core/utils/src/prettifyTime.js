module.exports = function(time) {
  return time < 1000 ? `${time}ms` : `${(time / 1000).toFixed(2)}s`;
};
