const local = require("./local")

module.exports = {
  double(x) {
    return local.add(x,x)
  }
}
