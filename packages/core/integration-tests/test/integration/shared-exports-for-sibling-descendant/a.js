import wraps from './wraps';

export default import('./child').then(mod => mod.default);
