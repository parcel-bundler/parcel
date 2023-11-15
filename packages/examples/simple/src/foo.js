export default function foo() {
  return 'hello!';
}

export function foo() {
  return 123;
}

export {bar} from './bar.js';
