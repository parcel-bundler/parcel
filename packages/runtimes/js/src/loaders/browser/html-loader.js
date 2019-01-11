module.exports = function loadHTMLBundle(bundle) {
  return fetch(bundle).then(function(res) {
    return res.text();
  });
};
