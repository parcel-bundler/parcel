import React from 'react';
import ReactDOM from 'react-dom/client';
import {Content} from '@parcel/rsc';

React.startTransition(() => {
  ReactDOM.hydrateRoot(document, <Content />);
});
