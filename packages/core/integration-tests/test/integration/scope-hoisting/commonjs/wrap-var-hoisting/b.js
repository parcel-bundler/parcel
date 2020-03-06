for(var BigIntSupported in [0, 1]){}

if (BigIntSupported) {
	var bigIntValue = () => true;
}

function is() {
	return BigIntSupported && bigIntValue();
}
exports.is = is;
