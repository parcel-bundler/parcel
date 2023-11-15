import foo from './foo';
import './bar';
import {button} from './button.module.css';

console.log(foo(122222222));
console.log(button);

let asset = new URL('./x.txt', import.meta.url);
console.log(asset);
