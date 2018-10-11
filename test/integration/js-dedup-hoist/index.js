import hello1 from './hello1'
import hello2 from './hello2'

export default async function () {
  let a = await import('./a');
  return `${hello1} ${hello2}! ${a.default}`;
}
