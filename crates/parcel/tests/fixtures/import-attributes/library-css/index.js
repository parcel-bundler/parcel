import './polyfill.js';
import sheet from './style.css' with { type: 'css' };

export default sheet instanceof CSSStyleSheet ? sheet.cssText : 'not a CSSStyleSheet';
