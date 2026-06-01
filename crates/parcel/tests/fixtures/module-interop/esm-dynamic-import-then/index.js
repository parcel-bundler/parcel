export default import('./dep.js').then(ns => ({ x: ns.x, y: ns.y }));
