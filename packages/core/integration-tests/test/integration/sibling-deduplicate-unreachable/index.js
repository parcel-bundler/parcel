import('./d');
import('./c');
import('./b');
output = import('./a').then(res => res.default);
export default output;
