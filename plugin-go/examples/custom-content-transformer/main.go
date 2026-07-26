// custom-content-transformer demonstrates storing parsed Go data on an asset
// and deferring code generation until Parcel packages the asset.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-content-transformer.dylib .
package main

import (
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

	value := strings.ToUpper(strings.Join(c.Words, " "))
	code := fmt.Sprintf(
		"// custom-content assets=%d bundles=%d dependencies=%d type=%s\nexport default %q;\n",
		graph.AssetCount(),
		graph.BundleCount(),
		dependencyCount,
		bundle.Type(),
		value,
	)
	return parcel.StringContent(code), nil
}

type CustomContentTransformer struct {
	parcel.DefaultPlugin
}

func (t *CustomContentTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	source := strings.TrimSpace(asset.Content())
	if source == "PANIC_TRANSFORM" {
		panic("example transform panic")
	}
	asset.SetCustomContent(&UppercaseContent{
		Source: source,
		Words:  strings.Fields(source),
	})
	if source == "PANIC_READ" {
		// Changing type causes the normal JS transformer to request the custom
		// content's string representation, exercising the read callback.
		asset.SetType("js")
	}
	return nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomContentTransformer{}, nil
	})
}

func main() {}
