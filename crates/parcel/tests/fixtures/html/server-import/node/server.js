import page from './page.html' with {type: 'text'};
export default page;
export const lazy = () => import('./lazy.js');
