const loadDependency = async function () {
  import('./prefetched-loaded', {prefetch: true}).then(file => file.default)
}

export default loadDependency;
