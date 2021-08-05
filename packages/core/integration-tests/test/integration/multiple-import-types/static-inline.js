import Foo from './other';
import text from 'bundle-text:./other';

// Get around bug with exports of symbols with bailouts...
const t = text;
export {Foo, t as text};
