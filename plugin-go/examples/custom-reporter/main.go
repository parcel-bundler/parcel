// custom-reporter is a Parcel reporter plugin written in Go. It prints what the
// build is doing, and renders failures the way Parcel itself does.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-reporter.dylib .
package main

import (
	"fmt"
	"os"
	"strings"
	"sync/atomic"

	parcel "github.com/parcel-bundler/parcel/plugin-go/v3"
)

type CustomReporter struct {
	builds atomic.Int32
}

// Fails to compile if CustomReporter stops handling one of these events, which
// would otherwise only show up as Parcel skipping it.
var (
	_ parcel.BuildStartReporter   = (*CustomReporter)(nil)
	_ parcel.BuildSuccessReporter = (*CustomReporter)(nil)
	_ parcel.BuildFailureReporter = (*CustomReporter)(nil)
	_ parcel.LogReporter          = (*CustomReporter)(nil)
)

func (r *CustomReporter) BuildStart(options *parcel.Options) error {
	fmt.Printf("build %d starting\n", r.builds.Add(1))
	return nil
}

func (r *CustomReporter) BuildSuccess(event *parcel.BuildSuccess, options *parcel.Options) error {
	fmt.Printf(
		"built %d bundles in %v (%d assets changed)\n",
		event.BundleGraph.BundleCount(),
		event.BuildTime,
		len(event.ChangedAssets),
	)
	return nil
}

func (r *CustomReporter) BuildFailure(event *parcel.BuildFailure, options *parcel.Options) error {
	summary := summarize(event.Diagnostics)
	// Written to a file when the build's environment names one, e.g. for CI.
	if path, ok := options.Env("REPORT_SUMMARY"); ok {
		return os.WriteFile(path, []byte(summary), 0o644)
	}
	fmt.Printf("build failed with %d diagnostics:\n%s", event.Diagnostics.Len(), summary)
	return nil
}

func (r *CustomReporter) Log(event *parcel.Log, options *parcel.Options) error {
	if event.Message != "" {
		fmt.Printf("[%s] %s\n", event.Level, event.Message)
	}
	for _, diagnostic := range event.Diagnostics.All() {
		fmt.Printf("[%s] %s\n", event.Level, diagnostic.Message())
	}
	return nil
}

// summarize describes each diagnostic, with where it points and what to read
// about it.
func summarize(diagnostics *parcel.Diagnostics) string {
	var summary strings.Builder
	for _, diagnostic := range diagnostics.All() {
		fmt.Fprintf(&summary, "message: %s\n", diagnostic.Message())
		if url := diagnostic.DocumentationURL(); url != "" {
			fmt.Fprintf(&summary, "docs: %s\n", url)
		}
		for _, frame := range diagnostic.CodeFrames() {
			file := frame.FilePath
			if file == "" {
				file = frame.URL
			}
			fmt.Fprintf(&summary, "frame: %s %s\n", file, frame.Language)
			for _, highlight := range frame.Highlights {
				fmt.Fprintf(&summary, "highlight: %d:%d-%d:%d %s\n",
					highlight.StartLine, highlight.StartColumn,
					highlight.EndLine, highlight.EndColumn, highlight.Message)
			}
		}
	}
	return summary.String()
}

func init() {
	parcel.RegisterPlugin(func(_ []byte) (any, error) {
		return &CustomReporter{}, nil
	})
}

func main() {}
