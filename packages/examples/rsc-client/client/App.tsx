import {ReactElement, Suspense} from 'react';
import {fetchRSC, setServerCallback} from '@parcel/rsc/client';

export function App() {
  return (
    <>
      <h1>Client rendered</h1>
      <Suspense fallback={<>Loading RSC</>}>
        <RSC />
      </Suspense>
    </>
  );
}

let request: Promise<ReactElement> | null = null;

function RSC() {
  // Simple cache to make sure we only fetch once.
  request ??= fetchRSC('http://localhost:3001');
  return request;
}

setServerCallback(async (id, args) => {
  let result = await fetchRSC('http://localhost:3001/action', {
    method: 'POST',
    headers: {
      'rsc-action-id': id,
    },
    body: args,
  });
  return result;
});
