// txt-transformer is a Parcel transformer plugin written in Go that converts
// plain text files into ES modules that export the file content as a string.
//
// Build with:
//
//	go build -buildmode=c-shared -o txt-transformer.dylib .
package main

import (
	"fmt"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type TxtTransformer struct {
	parcel.DefaultPlugin
}

func (t *TxtTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	content := asset.Content()
	// Emit an ES module that default-exports the text content.
	asset.SetContent(fmt.Sprintf("export default %q;\n", content))
	asset.SetType("js")
	return nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &TxtTransformer{}, nil
	})
}

func main() {}
