// @flow
import * as React from 'react';

import {useAppState} from '../AppState';

export default function SearchView(): React.Node {
  const [state, dispatch] = useAppState();
  const inputRef = React.useRef(null);

  const submitHandler = React.useCallback(
    e => {
      e.preventDefault();
      let searchValue = inputRef.current?.value;
      let node;
      if (searchValue != null) {
        for (let [k, v] of graph.nodes) {
          // TODO: search other fields as well?
          if (
            v.value?.publicId === searchValue ||
            v.value?.id === searchValue
          ) {
            // TODO: support multiple matches.
            node = k;
            break;
          }
        }
      }

      if (node != null) {
        dispatch({type: 'select', nodeId: node[0]});
      } else {
        dispatch({type: 'select', nodeId: null});
      }
    },
    [dispatch],
  );

  return (
    <form onSubmit={submitHandler}>
      <input
        className="search-view"
        name="search"
        placeholder="Search by publicId"
        type="search"
        ref={inputRef}
      />
    </form>
  );
}
