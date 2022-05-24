export function getLazyLoadedExports() {
  return import('./exports.js').then(module => {
    return module
  })
}
