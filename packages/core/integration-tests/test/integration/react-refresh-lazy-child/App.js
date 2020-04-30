import React, { Suspense, lazy, useState } from "react";

const child = import("./Async");
const Async = lazy(() => child);

let App = () => {
	const [x] = useState(Math.random());

	return (
		<Suspense fallback={"Loading"}>
			{x} <Async />
		</Suspense>
	);
};

export default App;
