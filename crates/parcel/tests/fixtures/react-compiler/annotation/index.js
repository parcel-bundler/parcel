import {renderToStaticMarkup} from 'react-dom/server.edge';

function Memo({label}) {
  'use memo';
  return <b>{label}</b>;
}

function Plain({label}) {
  return <i>{label}</i>;
}

output = renderToStaticMarkup(<><Memo label="a" /><Plain label="b" /></>);
