export default async function () {
  await import('./pageA.js');
  await import('./pageB.js');
  return 1;
}
