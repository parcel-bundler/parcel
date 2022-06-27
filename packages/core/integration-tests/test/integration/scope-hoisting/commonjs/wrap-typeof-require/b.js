if (typeof require === "function") {
  var jSuites = require("./c.js");
}
let x = () => {
  return jSuites + eval("1");
};
module.exports = x;
