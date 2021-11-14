output = import('./foo').then(res => res.default);
import('./baz');

export default output;
