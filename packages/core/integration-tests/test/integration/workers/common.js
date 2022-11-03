// required by worker and index, must be bundled separately
exports.commonFunction = function (source) {
  return 'commonText' + source;
};
