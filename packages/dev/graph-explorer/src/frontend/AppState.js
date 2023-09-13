// @flow
import * as React from 'react';

export type AppState = {|
  selectedNodeId: ?string,
  expandedNodeId: ?string,
  pinnedNodeIds: ?Set<string>,
|};

export type Action = {|
  type: 'select' | 'pin' | 'unpin' | 'expand' | 'collapse',
  nodeId: string,
|};

export type AppStateContext = [AppState, (action: Action) => void];

const INITIAL_STATE: AppState = {
  selectedNodeId: null,
  expandedNodeId: null,
  pinnedNodeIds: null,
};

// $FlowFixMe[incompatible-call]
const AppStateContext_ = React.createContext<AppStateContext>();

export const useAppState = (): AppStateContext => {
  let context = React.useContext(AppStateContext_);
  if (context === undefined) {
    throw new Error('useAppState must be used within a AppStateProvider');
  }
  return context;
};

type AppStateProviderProps = {|
  children: React.Node,
|};

export function AppStateProvider({
  children,
}: AppStateProviderProps): React.Node {
  let [state, dispatch] = React.useReducer<AppState, Action>(
    appStateReducer,
    INITIAL_STATE,
  );
  let value = React.useMemo(() => [state, dispatch], [state, dispatch]);
  return (
    <AppStateContext_.Provider value={value}>
      {children}
    </AppStateContext_.Provider>
  );
}

function appStateReducer(state: AppState, action: Action): AppState {
  //reducer function
  switch (action.type) {
    case 'select': {
      if (state.selectedNodeId !== action.nodeId) {
        return {...state, selectedNodeId: action.nodeId};
      }
      return state;
    }
    case 'pin': {
      if (!state.pinnedNodeIds?.has(action.nodeId)) {
        let updatedPins = new Set(state.pinnedNodeIds);
        updatedPins.add(action.nodeId);
        return {
          ...state,
          pinnedNodeIds: updatedPins,
        };
      }
      return state;
    }
    case 'unpin': {
      if (state.pinnedNodeIds?.has(action.nodeId)) {
        let updatedPins = new Set(state.pinnedNodeIds);
        updatedPins.delete(action.nodeId);
        return {
          ...state,
          pinnedNodeIds: updatedPins,
        };
      }
      return state;
    }
    case 'expand': {
      if (state.expandedNodeId !== action.nodeId) {
        return {...state, expandedNodeId: action.nodeId};
      }
      return state;
    }
    case 'collapse': {
      if (state.expandedNodeId === action.nodeId) {
        return {...state, expandedNodeId: null};
      }
      return state;
    }
    default:
      throw new Error();
  }
}
