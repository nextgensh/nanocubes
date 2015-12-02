// A simple function which is used to maintain the session variable for this user.
var _SESSION_ID = Date.now()+"_"+(Math.random()*Math.pow(10,17));

// Log server URL
var LOG_URL = "http://nextgensh.com:3000";

window.onbeforeunload = function() {
	// Flush the log buffer before we close the browser window.
	flush_log();
}
