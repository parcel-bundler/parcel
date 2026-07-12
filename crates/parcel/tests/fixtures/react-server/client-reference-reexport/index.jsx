import {ReExportedComponent, StarReExportedComponent} from './client';

function Server() {
  return <>
    <ReExportedComponent />
    <StarReExportedComponent />
  </>;
}

output = {Server};
