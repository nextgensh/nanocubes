// A very simple code which just writes the interactions logs to the db.

var express = require('express');
var cors = require('cors');
var sqlite3 = require('sqlite3');

var app = express();
var db = new sqlite3.Database('database');

// TODO : This is here only for debugging. In production the server
// and client requests will be on the same domain.
app.use(cors());

// Build the statement used for inserting data.
var insert = db.prepare("insert into interactions values (?, ?, ?)");

app.get('/', function (req, res) {	
	/*
	if(req.query.d && req.query.s) {
			insert.run(req.query.d, req.query.s, Date.now());
	}
	*/
	console.log(req.query.d);
	res.send("OK");
});

var server = app.listen(3000, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Server started on %s:%a', host, port);
});
