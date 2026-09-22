export default async function () {
  const [a, b] = await Promise.all([import('pkg/a.js'), import('pkg/b.js')]);
  return a.default + b.default;
}
