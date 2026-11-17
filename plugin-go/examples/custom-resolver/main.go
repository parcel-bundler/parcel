// custom-resolver is a Parcel resolver plugin written in Go that handles
// specifiers with a "custom:" prefix by mapping them to .js files in the
// same directory as the importing file.
//
// For example, `import x from "custom:foo"` resolves to `./foo.js`.
//
// `custom-deprecated:name` resolves the same way, with a warning. Both show
// diagnostics with more than one code frame: the warning points at the import
// and at what it resolved to, and a missing module's error at the import and at
// what to create.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-resolver.dylib .
package main

import (
	"fmt"
	"path/filepath"
	"strings"

	parcel "github.com/parcel-bundler/parcel/plugin-go/v3"
)

type CustomResolver struct{}

// Fails to compile if CustomResolver stops implementing parcel.Resolver, which would
// otherwise only show up as an error when Parcel calls it.
var _ parcel.Resolver = (*CustomResolver)(nil)

func (r *CustomResolver) Resolve(dep *parcel.Dependency, specifier, pipeline string, options *parcel.Options) (parcel.ResolveResult, error) {
	var name string
	var deprecated bool
	if rest, ok := strings.CutPrefix(specifier, "custom:"); ok {
		name = rest
	} else if rest, ok := strings.CutPrefix(specifier, "custom-deprecated:"); ok {
		name, deprecated = rest, true
	} else {
		return parcel.ResolveResult{}, nil
	}
	importer := dep.ResolveFrom()
	path := filepath.Join(filepath.Dir(importer), name+".js")

	// Where the import is, assuming it is on the first line, as in the fixtures.
	imported := parcel.CodeFrame{
		FilePath: importer,
		Highlights: []parcel.CodeHighlight{{
			StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 1,
			Message: fmt.Sprintf("`%s` imported here", specifier),
		}},
	}

	// Checked through Parcel, so creating the file later re-runs the resolve.
	if options.FileKind(path)&parcel.FileKindFile == 0 {
		return parcel.ResolveResult{}, &parcel.Diagnostic{
			Message: fmt.Sprintf("Could not find custom module `%s`", name),
			CodeFrames: []parcel.CodeFrame{
				imported,
				{
					URL:      "custom:" + name,
					Code:     fmt.Sprintf("export default %q;\n", name),
					Language: "js",
					Highlights: []parcel.CodeHighlight{{
						StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 6,
						Message: "create it like this",
					}},
				},
			},
			Hints: []string{"Create " + path, "Or import a module that exists"},
		}
	}

	if deprecated {
		options.LogDiagnostic(&parcel.Diagnostic{
			Message:  "`custom-deprecated:` is deprecated",
			Severity: parcel.SeverityWarning,
			CodeFrames: []parcel.CodeFrame{
				imported,
				{
					FilePath: path,
					Highlights: []parcel.CodeHighlight{{
						StartLine: 1, StartColumn: 1, Message: "resolved to this",
					}},
				},
			},
			Hints: []string{fmt.Sprintf("Import `custom:%s` instead", name)},
		})
	}
	return parcel.Resolved(path, ""), nil
}

func init() {
	parcel.RegisterPlugin(func(_ *parcel.Config, _ *parcel.Options) (any, error) {
		return &CustomResolver{}, nil
	})
}

func main() {}
