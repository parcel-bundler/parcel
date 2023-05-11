import { CHANNEL, DEFAULT_THEME_MODE, THEME_MODES } from '../constants';
// Resolves the different types of theme objects in the current API
export default function getTheme(props) {
  if (props && props.theme) {
    // Theme is the global Atlaskit theme
    if (CHANNEL in props.theme) {
      return props.theme[CHANNEL];
    }
    // User has provided alternative modes
    else if ('mode' in props.theme && THEME_MODES.includes(props.theme.mode)) {
      return props.theme;
    }
  }
  // If format not supported (or no theme provided), return standard theme
  return {
    mode: DEFAULT_THEME_MODE
  };
}