module.exports = {
  wide: require('url:./image.jpg?width=600'),
  narrow: require('url:./image.jpg?width=100'),
  high: require('url:./image.jpg?height=600'),
  short: require('url:./image.jpg?height=100'),
  small: require('url:./image.jpg?height=50&width=50'),
  large: require('url:./image.jpg?height=500&width=500')
}
