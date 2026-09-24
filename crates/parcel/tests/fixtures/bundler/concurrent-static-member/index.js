import a from './a';
export default async function () {
  const eager = a();
  const [lazyA, b] = await Promise.all([import('./a'), import('./b')]);
  return [eager, lazyA.default(), b.default()];
}
