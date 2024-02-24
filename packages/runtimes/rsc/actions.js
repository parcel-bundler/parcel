// Empty file that is replaced by the runtime.
let _actions = {};
export function registerServerActions(actions) {
  _actions = actions;
}

export async function importServerAction(id, name) {
  let load = _actions[id];
  if (load) {
    let mod = await load();
    let fn;
    if (name === '*') {
      fn = mod;
    } else if (name === 'default') {
      fn = mod?.__esModule ? mod.default : mod;
    } else if (mod) {
      fn = mod[name];
    }
    if (typeof fn === 'function') {
      return fn;
    }
  }

  throw new Error('Invalid server action: ' + id + ' ' + name);
}
