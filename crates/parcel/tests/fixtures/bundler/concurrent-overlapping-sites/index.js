import {load as editor} from './editor';
import {load as dashboard} from './dashboard';
export default async () => [await editor(), await dashboard()];
