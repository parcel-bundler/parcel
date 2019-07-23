module.exports = {
	plugins: [
		// Admittedly, using PostHTML for includes in Pug is unnecessary,
		// but posthtml-include is already a development dependency of Parcel,
		// so it's an easy pick for this example.
    require('posthtml-include')({
      root: __dirname
    })
  ]
}
