export function css(content) {
  this.addAsset({type: 'css', content});
  return 'hi';
}
