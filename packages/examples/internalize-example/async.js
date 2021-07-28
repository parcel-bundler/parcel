import v from './index-sync';

// internalized, different bundle
import('./index-sync').then(v => console.log('async', v.default));
