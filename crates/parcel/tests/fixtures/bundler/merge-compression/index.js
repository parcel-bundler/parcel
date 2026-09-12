export default async function () {
  return [(await import('./a.js')).default, (await import('./b.js')).default];
}
