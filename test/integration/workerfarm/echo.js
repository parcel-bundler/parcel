function echo(data) {
  return data;
}

function run(data) {
  return echo(data);
}

function init() {
  // do nothing
}

exports.run = run;
exports.init = init;
exports.echo = echo;