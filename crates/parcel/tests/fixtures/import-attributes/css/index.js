import './polyfill.js';
import sheet from './style.css' with { type: 'css' };
output = sheet instanceof CSSStyleSheet ? sheet.cssText : 'not a CSSStyleSheet';
