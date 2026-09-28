try {
  await import('./parent.js');
} catch (err) {
  sideEffect('caught ' + err.message);
}
try {
  await import('./parent.js');
} catch (err) {
  sideEffect('caught again ' + err.message);
}
try {
  await import('./throws.js');
} catch (err) {
  sideEffect('caught throws ' + err.message);
}
