// prepend-transformer is a Parcel transformer plugin written in Go that
// prepends a line to each asset, such as a license comment or a polyfill
// import, and keeps the source map an earlier transformer attached, so the
// bundle still maps back to the original files.
//
// Build with:
//
//	go build -buildmode=c-shared -o prepend-transformer.dylib .
package main

import (
	"encoding/json"

	parcel "github.com/parcel-bundler/parcel/plugin-go/v3"
)

type PrependTransformer struct {
	line string
}

// Fails to compile if PrependTransformer stops implementing parcel.Transformer, which would
// otherwise only show up as an error when Parcel calls it.
var _ parcel.Transformer = (*PrependTransformer)(nil)

func (t *PrependTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	source, err := asset.Content()
	if err != nil {
		return err
	}
	content := t.line + "\n" + source

	// Without a map, Parcel maps the asset as if this content were its source.
	sourceMap := asset.SourceMap()
	if sourceMap == "" {
		asset.SetContent(content)
		return nil
	}

	// Everything moved down a line. In VLQ mappings each ";" starts the next
	// generated line, so an empty one in front shifts the rest.
	var m map[string]any
	if err := json.Unmarshal([]byte(sourceMap), &m); err != nil {
		return err
	}
	if mappings, ok := m["mappings"].(string); ok {
		m["mappings"] = ";" + mappings
	}
	shifted, err := json.Marshal(m)
	if err != nil {
		return err
	}
	asset.SetContentWithMap(content, string(shifted))
	return nil
}

func init() {
	parcel.RegisterPlugin(func(config []byte) (any, error) {
		var c struct {
			Line *string `json:"line"`
		}
		if len(config) > 0 {
			if err := json.Unmarshal(config, &c); err != nil {
				return nil, err
			}
		}
		line := "/* Built with Parcel */"
		if c.Line != nil {
			line = *c.Line
		}
		return &PrependTransformer{line: line}, nil
	})
}

func main() {}
