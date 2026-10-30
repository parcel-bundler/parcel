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

type CustomOptimizer struct{}

// Fails to compile if CustomOptimizer stops implementing parcel.Optimizer, which would
// otherwise only show up as an error when Parcel calls it.
var _ parcel.Optimizer = (*CustomOptimizer)(nil)

func (*CustomOptimizer) Optimize(bundleGraph *parcel.BundleGraph, bundle *parcel.Bundle, contents []byte, sourceMap string, _ *parcel.Options) (parcel.OptimizeResult, error) {
	optimized := fmt.Sprintf(
		"/* optimized by Go: assets=%d bundles=%d type=%s map=%t */\n%s",
		bundleGraph.AssetCount(),
		bundleGraph.BundleCount(),
		bundle.Type(),
		sourceMap != "",
		contents,
	)
	return parcel.OptimizeResult{
		Contents:  parcel.StringContent(optimized),
		SourceMap: sourceMap,
	}, nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (any, error) {
		return &CustomOptimizer{}, nil
	})
}

func main() {}
