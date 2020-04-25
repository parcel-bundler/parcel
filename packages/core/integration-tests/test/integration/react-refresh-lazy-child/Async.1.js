import React, { useState } from "react";

let Async = () => {
	const [x] = useState(Math.random());

	return <div>OtherAsync:{x}</div>;
};

export default Async;
