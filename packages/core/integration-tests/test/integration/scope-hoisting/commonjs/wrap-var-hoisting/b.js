const BigIntSupported = true;

if (BigIntSupported) {
	var bigIntValue = () => true;
}

function is() {
	return BigIntSupported && bigIntValue();
}
exports.is = is;
