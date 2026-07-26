// custom-namer is a Parcel namer plugin written in Go. It prefixes entry
// bundle names with "go-" while preserving the bundle type extension.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-namer.dylib .
package main

import (
	"path/filepath"
	"strings"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type CustomNamer struct {
	parcel.DefaultPlugin
}

func (*CustomNamer) Name(bundleGraph *parcel.BundleGraph, bundle *parcel.Bundle, _ *parcel.Options) (string, error) {
	entry, ok := bundle.MainEntryAsset()
	if !ok {
		return "", nil
	}
	asset, ok := bundleGraph.Asset(entry)
	if !ok {
		return "", nil
	}
	base := filepath.Base(asset.FilePath())
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	return "go-" + stem + "." + bundle.Type(), nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomNamer{}, nil
	})
}

func main() {}
