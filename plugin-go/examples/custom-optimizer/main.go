// custom-optimizer is a Parcel optimizer plugin written in Go. It prepends a
// comment to JavaScript bundles and preserves an existing source map.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-optimizer.dylib .
package main

import (
	"fmt"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type CustomOptimizer struct {
	parcel.DefaultPlugin
}

func (*CustomOptimizer) Optimize(bundleGraph *parcel.BundleGraph, bundle *parcel.Bundle, contents, sourceMap []byte, _ *parcel.Options) (parcel.OptimizeResult, error) {
	optimized := fmt.Sprintf(
		"/* optimized by Go: assets=%d bundles=%d type=%s map=%t */\n%s",
		bundleGraph.AssetCount(),
		bundleGraph.BundleCount(),
		bundle.Type(),
		sourceMap != nil,
		contents,
	)
	return parcel.OptimizeResult{
		Contents:  parcel.StringContent(optimized),
		SourceMap: sourceMap,
	}, nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomOptimizer{}, nil
	})
}

func main() {}
