// custom-content-transformer demonstrates storing parsed Go data on an asset
// and deferring code generation until Parcel packages the asset.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-content-transformer.dylib .
package main

import (
	"encoding/json"
	"fmt"
	"strings"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

// UppercaseContent is an intentionally small stand-in for an AST. Parcel keeps
// this Go value as the asset's content until packaging.
type UppercaseContent struct {
	Source string
	Words  []string
}

// Read provides a source representation for tools that need to inspect the
// content before packaging.
func (c *UppercaseContent) Read() (parcel.Content, error) {
	if c.Source == "PANIC_READ" {
		panic("example custom content read panic")
	}
	return parcel.StringContent(c.Source), nil
}

// Package generates the final JavaScript module. It also demonstrates that the
// callback receives read-only access to the complete BundleGraph and Bundle.
func (c *UppercaseContent) Package(graph *parcel.BundleGraph, bundle *parcel.Bundle, _ *parcel.Options) (parcel.Content, error) {
	if c.Source == "PANIC_PACKAGE" {
		panic("example custom content package panic")
	}

	foundSelf := false
	dependencyCount := 0

	for _, asset := range graph.Assets() {
		for dependencyIndex := 0; dependencyIndex < asset.DependencyCount(); dependencyIndex++ {
			if _, ok := asset.Dependency(dependencyIndex); ok {
				dependencyCount++
				// Resolve using the asset and dependency indices used by the graph.
				graph.DependencyResolution(asset.Index(), dependencyIndex)
			}
		}

		if content, ok := asset.CustomContent(); ok {
			if current, ok := content.(*UppercaseContent); ok && current == c {
				foundSelf = true
			}
		}
	}

	if !foundSelf {
		return nil, fmt.Errorf("custom content was not accessible through BundleGraph")
	}

	// A JSON string is a JavaScript string literal; Go's %q escapes are not.
	value, err := json.Marshal(strings.ToUpper(strings.Join(c.Words, " ")))
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf(
		"// custom-content assets=%d bundles=%d dependencies=%d type=%s\nexport default %s;\n",
		graph.AssetCount(),
		graph.BundleCount(),
		dependencyCount,
		bundle.Type(),
		value,
	)
	return parcel.StringContent(code), nil
}

type CustomContentTransformer struct{}

// Fails to compile if CustomContentTransformer stops implementing parcel.Transformer, which would
// otherwise only show up as an error when Parcel calls it.
var _ parcel.Transformer = (*CustomContentTransformer)(nil)

func (t *CustomContentTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	content, err := asset.Content()
	if err != nil {
		return err
	}
	source := strings.TrimSpace(content)
	if source == "PANIC_TRANSFORM" {
		panic("example transform panic")
	}
	asset.SetCustomContent(&UppercaseContent{
		Source: source,
		Words:  strings.Fields(source),
	})
	if source == "PANIC_READ" {
		// Reading the content back runs the read callback. When it fails, the
		// error carries Parcel's diagnostic for it, which returning it reports
		// unchanged.
		if _, err := asset.Content(); err != nil {
			return err
		}
	}
	return nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (any, error) {
		return &CustomContentTransformer{}, nil
	})
}

func main() {}
