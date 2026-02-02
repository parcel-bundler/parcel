export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export function getUrl() {
  return new URL('test.txt', import.meta.url);
}

export function getAsync() {
  return import('./async').then(({test}) => test);
}

export * from './other';
