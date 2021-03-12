const loadDependency = async function () {
  return await import('./prefetched-loaded', {prefetch: true});
}

export default loadDependency;
