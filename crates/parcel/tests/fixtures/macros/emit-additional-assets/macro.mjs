export function css(v) {
  this.addAsset({
    type: 'css',
    content: '.foo {\n' + v + '\n}'
  });
  return 'foo';
}
