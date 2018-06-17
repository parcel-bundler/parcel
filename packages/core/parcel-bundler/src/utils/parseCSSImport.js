function parseCSSImport(url) {
  if (!/^(~|\.\/|\/)/.test(url)) {
    url = './' + url;
  } else if (!/^(~\/|\.\/|\/)/.test(url)) {
    url = url.substring(1);
  }
  return url;
}

module.exports = parseCSSImport;
