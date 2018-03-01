module.exports = function loadHtmlBundle(bundle) {
  return fetch(bundle).then(function (res) {
    return res.text();
  });
};
