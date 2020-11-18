# Requires graphviz for the dot command, and imagemagick for the convert command

# See https://stackoverflow.com/questions/40621451/makefile-automatically-compile-all-c-files-keeping-o-files-in-separate-folde
DOT := $(wildcard assetgraph/*.dot)
PNG := $(patsubst %.dot,%.png, $(DOT))

assetgraph.pdf: $(PNG)
	# Use a consistent "page" size and center all images
	# https://stackoverflow.com/questions/11693137/how-do-i-control-pdf-paper-size-with-imagemagick
	convert -page 1285x827 -gravity center $(PNG) $@

assetgraph/%.png: assetgraph/%.dot
	dot -Tpng $< -o $@

clean:
	rm $(PNG) assetgraph.pdf

.PHONY: clean
