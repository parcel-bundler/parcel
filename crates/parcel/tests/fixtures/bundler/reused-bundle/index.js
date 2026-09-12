export default async function () {
  return [
    (await import('./foo.js')).default,
    (await import('./bar.js')).default,
  ];
}
