module.exports = function loadHTMLBundle(bundle) {
  return fetch(bundle).then(res => res.text());
};
