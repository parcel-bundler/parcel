// custom-resolver is a Parcel resolver plugin written in Go that handles
// specifiers with a "custom:" prefix by mapping them to .js files in the
// same directory as the importing file.
//
// For example, `import x from "custom:foo"` resolves to `./foo.js`.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-resolver.dylib .
package main

import (
	"path/filepath"
	"strings"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type CustomResolver struct {
	parcel.DefaultPlugin
}

func (r *CustomResolver) Resolve(dep *parcel.Dependency, specifier, pipeline string, _ *parcel.Options) (parcel.ResolveResult, error) {
	if !strings.HasPrefix(specifier, "custom:") {
		return parcel.ResolveResult{}, nil
	}
	name := specifier[len("custom:"):]
	dir := filepath.Dir(dep.ResolveFrom())
	return parcel.Resolved(filepath.Join(dir, name+".js"), ""), nil
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomResolver{}, nil
	})
}

func main() {}
