function doesNotRun() {
  return import('./a');
}

export default () => import('./b').then(b => b.default);

