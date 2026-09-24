export async function load() {
  const [a, shared] = await Promise.all([import('./a'), import('./shared')]);
  return [a.default(), shared.default()];
}
