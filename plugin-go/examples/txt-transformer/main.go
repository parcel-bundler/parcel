// txt-transformer is a Parcel transformer plugin written in Go that converts
// plain text files into ES modules that export the file content as a string.
//
// Build with:
//
//	go build -buildmode=c-shared -o txt-transformer.dylib .
package main

import (
	"encoding/json"
	"fmt"

	parcel "github.com/parcel-bundler/parcel/plugin-go/v3"
)

type TxtTransformer struct{}

// Fails to compile if TxtTransformer stops implementing parcel.Transformer, which would
// otherwise only show up as an error when Parcel calls it.
var _ parcel.Transformer = (*TxtTransformer)(nil)

func (t *TxtTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	content, err := asset.Content()
	if err != nil {
		return err
	}
	// Emit an ES module that default-exports the text content.
	// A JSON string is a JavaScript string literal; Go's %q escapes are not.
	literal, err := json.Marshal(content)
	if err != nil {
		return err
	}
	asset.SetContent(fmt.Sprintf("export default %s;\n", literal))
	asset.SetType("js")
	return nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (any, error) {
		return &TxtTransformer{}, nil
	})
}

func main() {}
