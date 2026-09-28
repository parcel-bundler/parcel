import Page, {Server, foo} from './Page.jsx';
sideEffect('index');
output = {foo: foo.map(value => value * 2), server: typeof Server, page: typeof Page};
