import {renderToStaticMarkup} from 'react-dom/server.edge';

function App({label}) {
  return <b>{label}</b>;
}

output = renderToStaticMarkup(<App label="a" />);
