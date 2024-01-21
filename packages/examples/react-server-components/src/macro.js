export function addDependency(options) {
  let placeholder = Math.random().toString(36).slice(2);
  this.addDependency({
    ...options,
    meta: {
      placeholder
    }
  });
  return new Function(`return __parcel__require2__("${placeholder}")`);
}
