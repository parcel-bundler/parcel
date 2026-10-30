//go:build !parceltest

package parcel

import "testing"

// The tests need the cgo helpers in testapi.go, which only the parceltest tag
// compiles. Without it, say so rather than quietly running nothing.
func TestRequiresTheParceltestTag(t *testing.T) {
	t.Fatal("run the tests with -tags parceltest: go test -tags parceltest ./...")
}
