export async function load() {
  const [a, b] = await Promise.all([import('./a'), import('./b')]);
  return [a.default(), b.default()];
}
