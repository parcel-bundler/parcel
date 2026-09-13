export default async function () {
  return [
    (await import('./pageA.js')).default,
    (await import('./pageB.js')).default,
  ];
}
