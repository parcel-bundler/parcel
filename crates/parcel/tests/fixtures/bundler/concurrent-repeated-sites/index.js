import {load as first} from './first';
import {load as second} from './second';
export default async () => [await first(), await second()];
