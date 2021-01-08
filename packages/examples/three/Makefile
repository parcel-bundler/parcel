github:
	git clone --depth 1 --branch r108 https://github.com/mrdoob/three.js.git github

src: | github
	mkdir -p src
	echo > src/entry.js
	for i in 1 2 3 4; do test -d "src/copy$$i" || cp -r github/src "src/copy$$i"; done
	for i in 1 2 3 4; do echo "import * as copy$$i from './copy$$i/Three.js';" >> src/entry.js; done
	echo 'Line count:' && find src -name '*.js' | xargs wc -l | tail -n 1
