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

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type CustomReporter struct {
	parcel.DefaultPlugin
	builds atomic.Int32
}

func (r *CustomReporter) Report(event parcel.ReportEvent, options *parcel.Options) error {
	switch event := event.(type) {
	case *parcel.BuildStart:
		r.builds.Add(1)
		fmt.Printf("build %d starting\n", r.builds.Load())

	case *parcel.BuildSuccess:
		fmt.Printf(
			"built %d bundles in %v (%d assets changed)\n",
			event.BundleGraph.BundleCount(),
			event.BuildTime,
			len(event.ChangedAssets),
		)

	case *parcel.BuildFailure:
		summary := summarize(event.Diagnostics)
		// Written to a file when the build's environment names one, e.g. for CI.
		if path, ok := options.Env("REPORT_SUMMARY"); ok {
			return os.WriteFile(path, []byte(summary), 0o644)
		}
		fmt.Printf("build failed with %d diagnostics:\n%s", event.Diagnostics.Len(), summary)

	case *parcel.Log:
		if event.Message != "" {
			fmt.Printf("[%s] %s\n", event.Level, event.Message)
		}
		for _, diagnostic := range event.Diagnostics.All() {
			fmt.Printf("[%s] %s\n", event.Level, diagnostic.Message())
		}
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
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomReporter{}, nil
	})
}

func main() {}
