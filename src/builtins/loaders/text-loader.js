module.exports = function loadTextBundle(bundle) {
  return fetch(bundle).then(function (res) {
    return res.text();
  });
};
