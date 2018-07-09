class CSSAst {
  constructor(css, root) {
    this.css = css;
    this.root = root;
    this.dirty = false;
  }

  render() {
    if (this.dirty) {
      this.css = '';
      postcss.stringify(this.root, c => (this.css += c));
    }

    return this.css;
  }
}

module.exports.CSSAst = CSSAst;
