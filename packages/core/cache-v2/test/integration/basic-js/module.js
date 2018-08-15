const otherModule = require('./otherModule');

function something() {
  console.log(otherModule());
}

module.exports = something;