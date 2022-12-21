/* @jsx h */

const Boom = () => {
  const littleBoom = ['hello', 'world']
  return <div>{...littleBoom.map(el => el)}</div>
}
class X {
  #x(){}
  #x(){}
}
console.log(Boom, X);
