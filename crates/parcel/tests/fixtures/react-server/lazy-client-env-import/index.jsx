import {use} from 'react' with {env: 'react-client'};
output = {use, load: () => import('./Page.jsx')};
