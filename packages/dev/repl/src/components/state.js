// @flow
import type {REPLOptions, CodeMirrorDiagnostic} from '../utils';

import {ASSET_PRESETS, FS, join, type FSMap} from '../utils/assets';
import path from 'path';
import nullthrows from 'nullthrows';

// const isSafari = navigator.vendor.includes('Apple Computer');

export const DEFAULT_OPTIONS: REPLOptions = {
  entries: [],
  minify: false,
  scopeHoist: true,
  sourceMaps: false,
  publicUrl: '/__repl_dist',
  targetType: 'browsers',
  targetEnv: null,
  outputFormat: null,
  hmr: false,
  mode: 'production',
  renderGraphs: false,
  viewSourcemaps: false,
  dependencies: [],
  numWorkers: 0,
  // numWorkers: isSafari ? 0 : null,
};

export type State = {|
  currentView: number,
  files: FS,
  views: Map<string, {|value: string|} | {|component: any|}>,
  browserCollapsed: Set<string>,
  isEditing: null | string,
  options: REPLOptions,
  useTabs: boolean,
  diagnostics: Map<string, Array<CodeMirrorDiagnostic>>,
|};

export const initialState: State = {
  currentView: 0,
  files: new FS(),
  views: new Map(),
  browserCollapsed: new Set(),
  isEditing: null,
  options: DEFAULT_OPTIONS,
  useTabs: false,
  diagnostics: new Map(),
};

function loadPreset(
  name = 'Javascript',
  data: ?{|options?: $Shape<REPLOptions>, fs: FSMap|},
) {
  let preset = nullthrows(data ?? ASSET_PRESETS.get(name));
  let state = {
    ...initialState,
    useTabs: data != null,
    files: new FS(preset.fs),
    options: {
      ...initialState.options,
      ...preset.options,
    },
  };

  if (!state.useTabs) {
    for (let [name] of state.files.list()) {
      state = reducer(state, {type: 'view.open', name});
    }
  }

  return state;
}

export const getInitialState = (): State => {
  let loaded = loadState();
  if (loaded) return loaded;

  return loadPreset();
};

export function reducer(state: State, action: any): State {
  switch (action.type) {
    case 'view.select':
      return {...state, currentView: action.index};
    case 'view.open': {
      let views = new Map([
        ...state.views,
        [
          action.name,
          action.component
            ? {component: action.component}
            : {value: nullthrows(state.files.get(action.name)).value},
        ],
      ]);
      let viewIndex = [...views].findIndex(([n]) => n === action.name);
      return {
        ...state,
        views,
        currentView: viewIndex,
      };
    }
    case 'view.close':
      return {
        ...state,
        views: new Map([...state.views].filter(([n]) => n != action.name)),
      };
    case 'view.setValue': {
      let data = nullthrows(state.views.get(action.name));
      if (data.component) {
        return state;
      }
      let newState = {
        ...state,
        views: new Map([
          ...state.views,
          [action.name, {...data, value: action.value}],
        ]),
      };

      // Always save immediately in list mode
      if (!state.useTabs) {
        let file = nullthrows(state.files.get(action.name));
        if (file.value === action.value) return state;

        newState = {
          ...newState,
          files: state.files.setMerge(action.name, {value: action.value}),
        };
      }
      return newState;
    }
    case 'view.saveCurrent': {
      if (state.useTabs) {
        let [name, view] = [...state.views][state.currentView];
        if (view.value == null) return state;

        let value = view.value;
        let file = nullthrows(state.files.get(name));
        if (file.value === value) return state;

        return {
          ...state,
          files: state.files.setMerge(name, {value}),
        };
      } else {
        // let files = state.files;
        // for (let [name, view] of state.views) {
        //   if (view.value == null) {
        //     continue;
        //   }
        //   // $FlowFixMe
        //   let value = view.value;
        //   let file = nullthrows(state.files.get(name));
        //   if (file.value === value) {
        //     continue;
        //   }
        //   files = files.setMerge(name, {value});
        // }
        // if (files === state.files) return state;

        // return {
        //   ...state,
        //   files,
        // };
        return state;
      }
    }
    case 'view.closeCurrent':
      return {
        ...state,
        views: new Map(
          [...state.views].filter((_, i) => i !== state.currentView),
        ),
      };

    case 'file.move': {
      let oldName = action.name;
      let newName = join(action.dir, path.basename(action.name));
      return {
        ...state,
        files: state.files.move(oldName, newName),
        browserCollapsed: new Set(
          [...state.browserCollapsed].map(f =>
            f === action.name ? newName : f,
          ),
        ),
        views: new Map(
          [...state.views].map(([name, data]) => [
            name === oldName ? newName : name,
            data,
          ]),
        ),
      };
    }
    case 'file.delete':
      return {
        ...state,
        files: state.files.delete(action.name),
        views: new Map(
          [...state.views].filter(([name]) => !name.startsWith(action.name)),
        ),
      };
    case 'file.addFile': {
      let prefix = state.files.has('/src') ? '/src' : '';
      let i = 1;
      while (state.files.has(`${prefix}/file${i}.js`)) {
        i++;
      }
      let file = `${prefix}/file${i}.js`;
      let newState = {
        ...state,
        files: state.files.set(file, {value: ''}),
      };
      if (!state.useTabs) {
        newState = reducer(newState, {
          type: 'view.open',
          name: file,
        });
      }
      return newState;
    }
    case 'file.addFolder': {
      let i = 1;
      while (state.files.has(`/folder${i}`)) {
        i++;
      }
      return {
        ...state,
        files: state.files.set(`/folder${i}`, new Map()),
      };
    }
    case 'file.isEntry': {
      return {
        ...state,
        files: state.files.setMerge(action.name, {isEntry: action.value}),
      };
    }
    case 'browser.expandToggle': {
      return {
        ...state,
        browserCollapsed: state.browserCollapsed.has(action.name)
          ? new Set([...state.browserCollapsed].filter(n => n != action.name))
          : new Set([...state.browserCollapsed, action.name]),
      };
    }
    case 'browser.setEditing': {
      if (state.isEditing != null && action.name == null) {
        let oldName = state.isEditing;
        let newName = join(path.dirname(state.isEditing), action.value);
        state = {
          ...state,
          files: state.files.move(oldName, newName),
          browserCollapsed: new Set(
            [...state.browserCollapsed].map(f => (f === oldName ? newName : f)),
          ),
          views: new Map(
            [...state.views].map(([name, data]) => [
              name === oldName ? newName : name,
              data,
            ]),
          ),
        };
      }
      return {
        ...state,
        isEditing: action.name || null,
      };
    }
    case 'preset.load':
      return loadPreset(action.name, action.data);
    case 'options':
      return {
        ...state,
        options: {
          ...state.options,
          [action.name]: action.value,
        },
      };
    case 'toggleView': {
      let useTabs = !state.useTabs;
      return {
        ...state,
        useTabs,
      };
    }
    case 'diagnostics': {
      return {
        ...state,
        diagnostics: action.value ?? new Map(),
      };
    }
    default:
      throw new Error();
  }
}

export function saveState(state: State) {
  let data = {
    files: state.files.toJSON(),
    options: state.options,
    useTabs: state.useTabs,
    browserCollapsed: [...state.browserCollapsed],
    views: [...state.views.keys()],
    currentView: state.currentView,
  };

  let dataStr = JSON.stringify(data);
  if (dataStr.length < 1_000_000) {
    window.location.hash = btoa(encodeURIComponent(dataStr));
  }
}

export function loadState(): ?State {
  const hash = window.location.hash.replace(/^#/, '');

  try {
    const data = JSON.parse(decodeURIComponent(atob(hash)));

    const files = FS.fromJSON(data.files);
    return {
      ...initialState,
      files,
      views: new Map(
        data.views
          .map(name => [name, files.get(name)])
          .filter(([, data]) => data),
      ),
      options: {...data.options, numWorkers: DEFAULT_OPTIONS.numWorkers},
      useTabs: data.useTabs,
      currentView: data.currentView,
      browserCollapsed: new Set(data.browserCollapsed),
    };
  } catch (e) {
    window.location.hash = '';
    return null;
  }
}
