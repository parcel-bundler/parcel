try {
  await import('./entry.jsx');
} catch (error) {
  sideEffect('caught ' + error.message);
}
output = 'done';
