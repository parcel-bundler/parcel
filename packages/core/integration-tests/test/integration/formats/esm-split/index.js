export default Promise.all([import('./async1'), import('./async2')]).then(
	([{default: [a, b, c]}, {default: [x, y, z]}]) =>
		a === 'async1' && x === 'async2' && b === y && c === z,
);
