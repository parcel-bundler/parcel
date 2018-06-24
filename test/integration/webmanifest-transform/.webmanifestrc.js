module.exports = function (manifest) {
  const str = JSON.stringify(manifest)
    .replace('{{ APP_NAME }}', 'Foo')
  return JSON.parse(str)
}
