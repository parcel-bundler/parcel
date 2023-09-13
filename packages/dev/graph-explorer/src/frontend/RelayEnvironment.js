// @flow
import * as React from 'react';
import {useMemo} from 'react';
import {RelayEnvironmentProvider} from 'react-relay';
import {
  Store,
  RecordSource,
  Environment,
  Network,
  Observable,
} from 'relay-runtime';

import type {FetchFunction, IEnvironment} from 'relay-runtime';

const fetchFn: FetchFunction = (params, variables) => {
  const response = fetch('/graphql', {
    method: 'POST',
    headers: [['Content-Type', 'application/json']],
    body: JSON.stringify({
      query: params.text,
      variables,
    }),
  });

  return Observable.from(response.then(data => data.json()));
};

export function createEnvironment(): IEnvironment {
  const network = Network.create(fetchFn);
  const store = new Store(new RecordSource());
  return new Environment({store, network});
}

type RelayEnvironmentProps = {|
  +children?: React.Node,
|};

export default function RelayEnvironment({
  children,
}: RelayEnvironmentProps): React.Node {
  const environment = useMemo(() => {
    return createEnvironment();
  }, []);

  return (
    <RelayEnvironmentProvider environment={environment}>
      {children}
    </RelayEnvironmentProvider>
  );
}
