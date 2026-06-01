export default async function () {
  const ns = await import('./dep.js');
  return { x: ns.x, y: ns.y };
}
