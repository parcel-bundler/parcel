export function test(a, b) {
  return new Function('c', `return ${a} + ${b} + c`);
}
