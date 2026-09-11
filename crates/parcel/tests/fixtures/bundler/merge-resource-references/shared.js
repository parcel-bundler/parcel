import text from 'bundle-text:./text.txt';
import url from 'url:./url.txt';
sideEffect('shared');
export default text.length + Number(url.endsWith('.txt'));
