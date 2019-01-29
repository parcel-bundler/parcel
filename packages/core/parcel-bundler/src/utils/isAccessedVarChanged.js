/*
  Checks if any of the used variable from process.env is changed
*/
function isAccessedVarChanged(cacheData) {
  for (let key in cacheData.env) {
    if (cacheData.env[key] !== process.env[key]) {
      return true;
    }
  }

  return false;
}

module.exports = isAccessedVarChanged;
