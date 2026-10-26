import workletUrl from './worklet.js' with { type: 'url', env: 'worklet' };
import {gain} from './gain.js';
sideEffect(typeof workletUrl === 'string' && /worklet-[0-9a-z]+\.js$/.test(workletUrl));
sideEffect(gain);
