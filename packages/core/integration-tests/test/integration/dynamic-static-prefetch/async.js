function neverCalled() {
  import('./prefetched', {prefetch: true});
}
