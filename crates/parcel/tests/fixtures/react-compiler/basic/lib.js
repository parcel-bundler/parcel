import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server.edge';
import {Lib} from 'lib';

output = renderToStaticMarkup(createElement(Lib));
