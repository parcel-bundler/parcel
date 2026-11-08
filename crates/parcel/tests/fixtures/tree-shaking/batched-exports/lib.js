const first = 'first';
const second = 'second';
const proto = 'proto';
const dashed = 'dashed';
export let live = 1;
export function increment() {
  live++;
}
export {first, dashed as 'dashed-name', second, proto as '__proto__'};
