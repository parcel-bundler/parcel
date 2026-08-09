// custom-reporter is a Parcel reporter plugin written in Go. It prints what the
// build is doing, and renders failures the way Parcel itself does.
//
// Build with:
//
//	go build -buildmode=c-shared -o custom-reporter.dylib .
package main

import (
	"fmt"
	"sync/atomic"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type CustomReporter struct {
	parcel.DefaultPlugin
	builds atomic.Int32
}

func (r *CustomReporter) Report(event parcel.ReportEvent, _ *parcel.Options) error {
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
		fmt.Printf("build failed with %d diagnostics:\n", event.Diagnostics.Len())
		for _, diagnostic := range event.Diagnostics.All() {
			fmt.Println(diagnostic.Message())
		}

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

func init() {
	parcel.RegisterPlugin(func(_ []byte) (parcel.Plugin, error) {
		return &CustomReporter{}, nil
	})
}

func main() {}
