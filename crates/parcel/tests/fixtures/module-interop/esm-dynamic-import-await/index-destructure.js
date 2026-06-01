export default async function () {
  const { x, y } = await import('./dep.js');
  return { x, y };
}
