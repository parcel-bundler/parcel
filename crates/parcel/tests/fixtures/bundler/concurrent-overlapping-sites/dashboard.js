export async function load() {
  const [b, shared] = await Promise.all([import('./b'), import('./shared')]);
  return [b.default(), shared.default()];
}
