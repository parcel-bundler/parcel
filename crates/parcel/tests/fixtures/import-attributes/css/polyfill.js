globalThis.CSSStyleSheet = class CSSStyleSheet {
  constructor() {
    this.cssText = '';
  }
  replaceSync(text) {
    this.cssText = text;
  }
};
