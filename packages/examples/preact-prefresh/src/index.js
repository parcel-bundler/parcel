import {render, h, options} from 'preact';
import {App} from './App';

console.log('rendering!', options);
render(<App />, document.getElementById('root'));
