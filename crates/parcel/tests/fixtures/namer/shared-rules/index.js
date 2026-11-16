import './style.css';
export default Promise.all([import('./a'), import('./b')]);
