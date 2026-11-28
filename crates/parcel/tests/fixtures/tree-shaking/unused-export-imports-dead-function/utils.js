import {heavy} from './heavy.js';
import {light} from './light.js';

export function a() {
  if (process.env.NODE_ENV !== 'production') {
    displayName();
  }
  return light();
}

// Only called in development, like a component's display name.
function displayName() {
  return heavy();
}
