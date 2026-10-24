import {renderToStaticMarkup} from 'react-dom/server.edge';
import {App} from './App';

output = renderToStaticMarkup(<App items={['a', 'b']} />);
