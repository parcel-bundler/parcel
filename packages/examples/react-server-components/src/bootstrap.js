import React from 'react';
import ReactDOM from 'react-dom/client';
import {Content} from '@parcel/rsc';

if (typeof document !== 'undefined') {
  React.startTransition(() => {
    ReactDOM.hydrateRoot(document, <Content />);
  });
}
