var result;
if (true) {
  result = require('./dep-a.js');
} else {
  result = require('./dep-b.js');
}
output = result;
