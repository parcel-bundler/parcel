import { snapShot } from "./file2";

export interface State {
  value: any;
}

type ContextType = ReturnType<typeof snapShot<State>>;
function id<T>(v: T) {
  return v;
}
const Context = id<ContextType | null>(null);

export function useStateContext() {
  return Context;
}
