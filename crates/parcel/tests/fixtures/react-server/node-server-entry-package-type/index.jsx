import * as page from './barrel.js' with {env: 'react-server'};
output = {keys: Object.keys(page).sort(), value: page.value, dynamic: page.dynamic};
