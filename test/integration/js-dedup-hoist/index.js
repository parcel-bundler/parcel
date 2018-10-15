import hello1 from './hello1'
import hello2 from './hello2'

export default function () {
  return import('./a').then(function (a) {
    return `${hello1} ${hello2}! ${a.default}`;
  });
}
