// https://github.com/parcel-bundler/parcel/issues/6732
import 'react-native/Libraries/Core/InitializeCore.js';

import {AppRegistry} from 'react-native';
import App from './App';
// import {name as appName} from './app.json';

AppRegistry.registerComponent('test', () => App);
