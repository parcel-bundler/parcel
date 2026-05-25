module.exports = function () {
  if(process.env.ABC === 'a') {
    return require("./unused.js");
  } else {
    return "ok";
  }
};
