if (Date.now () < 0) {
  import('./a');
}

export default import('./b').then(mod => mod.default);
