export let manifest = [];
export let version = '';

// Called by the runtime.
export function _register(m, v) {
  manifest = m;
  version = v;
}
