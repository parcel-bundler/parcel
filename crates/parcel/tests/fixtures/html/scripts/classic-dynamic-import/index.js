var globalVar = 'global';
function load() {
  return import('./async.js');
}
load().then(function (m) {
  output = m.default;
});
