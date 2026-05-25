interface HeaderAction {}

let setCurrentAction = (arg: any) => {};
let getCurrentAction = () => {
  return {};
};

const setAction = (fields: Partial<HeaderAction>) => {
  setCurrentAction({ ...<HeaderAction>getCurrentAction(), ...fields });
};
