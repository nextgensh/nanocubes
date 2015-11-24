var Nanocube = {};

// A buffer which stores the interaction requests.
var log_buffer = new Array();

// Max number of elements that can be stored inside the buffer.
var log_buffer_size = 16;

// A dummy function which only sends the requests to log server only.
function sendajax_logserver(url) {

	// Add the elements to the buffer.
	log_buffer[log_buffer.length] = {"timestamp":Date.now(), "url":url};

	if(log_buffer.length >= log_buffer_size) {
		flush_log();
	}
}

// Function which flushes the buffer data to server.
// NOTE : JSON.stringify() will not work on IE6/7 curses !
function flush_log() {
	// Package everything into a json.
	log_json = JSON.stringify({"elements":log_buffer});
	log_buffer = new Array();
	console.log(log_json);

   	$.ajax({url: LOGURL+"?d="+log_json+"&s="+_SESSION_ID+"", success: function(result){
   	}});
}

function binary_xhr(url, handler)
{
    var xhr = new window.XMLHttpRequest();
    var ready = false;
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status === 200
            && ready !== true) {
            if (xhr.responseType === "arraybuffer") {
                handler(xhr.response, url);
            } else if (xhr.mozResponseArrayBuffer !== null) {
                handler(xhr.mozResponseArrayBuffer, url);
            } else if (xhr.responseText !== null) {
                var data = String(xhr.responseText);
                var ary = new Array(data.length);
                for (var i = 0; i <data.length; i++) {
                    ary[i] = data.charCodeAt(i) & 0xff;
                }
                var uint8ay = new Uint8Array(ary);
                handler(uint8ay.buffer, url);
            }
            ready = true;
        }
    };
    xhr.open("GET", url, true);
    xhr.responseType="arraybuffer";
    xhr.send();

	sendajax_logserver(url);
};

Nanocube.diff_queries = function(q1, q2)
{
    var result = {
        when: ((_.isUndefined(q1.when) && !_.isUndefined(q2.when)) ||
               (_.isUndefined(q2.when) && !_.isUndefined(q1.when)) ||
               (!_.isUndefined(q1.when) && !_.isUndefined(q2.when) && 
                _.any(q1.when, function(v, k) {
                    return q2.when[k] !== v;
                }))),
        where: _.any(q1.where, function(v1, k) {
            var v2 = q2.where[k] || [];
            return v1.length != v2.length || _.any(v1, function(v_elt, i) {
                return v1[i] !== v2[i];
            });
        }) || _.any(q2.where, function(v1, k) {
            var v2 = q1.where[k] || [];
            return v1.length != v2.length || _.any(v1, function(v_elt, i) {
                return v1[i] !== v2[i];
            });
        }),
        region: ((_.isUndefined(q1.region) && !_.isUndefined(q2.region)) ||
                 (_.isUndefined(q2.region) && !_.isUndefined(q1.region)) ||
                 (!_.isUndefined(q1.region) && !_.isUndefined(q2.region) && (
                     (q1.region.z !== q2.region.z) ||
                         (q1.region.x[0] !== q2.region.x[0]) ||
                         (q1.region.x[1] !== q2.region.x[1]) ||
                         (q1.region.y[0] !== q2.region.y[0]) ||
                         (q1.region.y[1] !== q2.region.y[1]))))
    };
    return result;
};

Nanocube.create = function(opts)
{
    var url = opts.url;
    var max_zoom;
    var resolution = _.isUndefined(opts.resolution)?8:opts.resolution;

    function tile_subquery(opts) {
        opts = opts || {};
        var x = opts.x || 0, y = opts.y || 0, z = opts.z || 0;
        var r = opts.resolution || resolution;
        return z + 
            "/" + r + 
            "/" + x + 
            "/" + ((1 << z) - 1 - y);
    }

    function field_subquery(opts) {
        opts = opts || {};
        var result = "";
        var i = 0;
        for (var k in opts) {
            if (i++) result = result + ";";
            result = result + k + "=" + opts[k].join("|");
        }
        return result;
    }

    function time_subquery(opts) {
        return opts.from + "/" + opts.step + "/" + opts.count;
    }

    function time_range_subquery(opts) {
        if (_.isUndefined(opts) || _.isUndefined(opts.from))
            return "/0/10000000000";
        return "/" + opts.from + "/" + opts.to;
    }

    //////////////////////////////////////////////////////////////////////////
    // query generators for query/ scheme

    function region_subquery(opts) {
        if (_.isUndefined(opts))
            opts = { x: [0, 1 << max_zoom], y: [0, 1 << max_zoom], z: max_zoom };
        if (opts.z > max_zoom) {
            var shrinkage = 1 << (opts.z - max_zoom);
            opts = { x: [(opts.x[0] / shrinkage) | 0, (opts.x[1] / shrinkage) | 0],
                     y: [(opts.y[0] / shrinkage) | 0, (opts.y[1] / shrinkage) | 0],
                     z: max_zoom };
        }
        return "region/" + opts.z + "/" + opts.x[0] + "/" + opts.y[0] + "/" + opts.x[1] + "/" + opts.y[1];
    }

    function where_subquery(opts) {
        var a = _.map(opts, function(v, k) {
            v = v.join("|");
            return k + "=" + v;
        });
        if (a.length)
            return "/where/" + a.join(";");
        else
            return "";
    }

    function when_subquery(opts) {
        if (_.isUndefined(opts) || _.isUndefined(opts.from))
            return "";
        else
            return "/tseries/" + opts.from + "/" + (opts.to - opts.from) + "/1";
    }

    var result = {
        version: undefined,
        schema: undefined,
        to_tbin: function(time) {
            var delta = (time.getTime() - this.schema.time_schema.epoch.getTime());
            return ~~(delta / this.schema.time_schema.tick);
        },
        from_tbin: function(tbin) {
            var newtime = this.schema.time_schema.epoch.getTime() + (tbin * this.schema.time_schema.tick);
            return new Date(newtime);
        },
        tile: function(opts, k) {
            var that = this;
            var tile = tile_subquery(opts.tile);
            var time = time_range_subquery(opts.time);
            var fields = field_subquery(opts.fields);
            var this_url = url + "/tile/" + tile + time + "/" + fields;
            var resolution = opts.tile.resolution || resolution;
            
            binary_xhr(this_url, function(data) {
                var version = that.version;
                if (data === null) {
                    k({x:[], y:[], count:[]});
                    return;
                }
                if (_.isUndefined(version)) {
                    var record_size = 6;
                    var view = new DataView(data);
                    var n_records = data.byteLength / record_size;
                    // slow, meh
                    var x_array = new Uint8Array(n_records);
                    var y_array = new Uint8Array(n_records);
                    var count_array = new Uint32Array(n_records);
                    for (var i=0; i<n_records; ++i) {
                        x_array[i] = view.getUint8(record_size*i+1) << (8 - resolution);
                        y_array[i] = 256 - ((1 + view.getUint8(record_size*i)) << (8 - resolution));
                        count_array[i] = view.getInt32(record_size*i+2, true);
                    }
                    k({x: x_array, y: y_array, count: count_array});
                } else if (version === "0.0.1") {
                    var record_size = 10;
                    var view = new DataView(data);
                    var n_records = data.byteLength / record_size;
                    // slow, meh
                    var x_array = new Uint8Array(n_records);
                    var y_array = new Uint8Array(n_records);
                    var count_array = new Float64Array(n_records);
                    for (var i=0; i<n_records; ++i) {
                        x_array[i] = view.getUint8(record_size*i+1) << (8 - resolution);
                        y_array[i] = 256 - ((1 + view.getUint8(record_size*i)) << (8 - resolution));
                        count_array[i] = view.getFloat64(record_size*i+2, true);
                    }
                    k({x: x_array, y: y_array, count: count_array});
                } else {
                    throw new Error("Unsupported version '" + version + "'");
                }
            });
        },
        time_series: function(opts, k) {
            var time = time_subquery(opts.time);
            var region = region_subquery(opts.region);
            var this_url = url + "/query/tseries/" + time + "/" + region;
            this_url = this_url + where_subquery(opts.where);
            d3.json(this_url, function(data) { k(data); });
        },
        category: function(opts, k) {
            var field = opts.fields.join("/field/");
            var region = region_subquery(opts.region);
            var this_url = url + "/query/field/" + field + "/" + region;
            this_url = this_url + where_subquery(opts.where);
            this_url = this_url + when_subquery(opts.when);
            d3.json(this_url, function(data) { k(data); });
        },
        all: function(opts, k) {
            var region = region_subquery(opts.region);
            var this_url = url + "/query/" + region;
            this_url = this_url + where_subquery(opts.where);
            this_url = this_url + when_subquery(opts.when);
            d3.json(this_url, function(data) { k(data); });
			sendajax_logserver(this_url);
        },
        selection: function() {
            var nanocube = this;
            var observers = [];

            return {
                query: {
                    where: {},
                    region: { x: [0, 1 << max_zoom], y: [0, 1 << max_zoom], z: max_zoom }
                },
                nanocube: nanocube,
                refresh: function() { 
                    var that = this;
                    _.each(observers, function(f) { f(that.query); });
                    return this;
                },
                update_when: function(new_when) {
                    if (_.isUndefined(new_when)) {
                        delete this.query.when;
                    } else {
                        this.query.when = new_when;
                    }
                    return this;
                },
                update_region: function(new_region) {
                    this.query.region = new_region;
                    return this;
                },
                update_where: function(key, value) {
                    this.query.where[key] = value;
                    if (value.length === 0)
                        delete this.query.where[key];
                    return this;
                },
                all: function(k) {
                    var result = function(q) {
                        nanocube.all(q, k);
                    };
                    observers.push(result);
                    return result;
                },
                category: function(fields, k) {
                    var result = function(q) {
                        nanocube.category(_.extend(q, { fields: fields }), k);
                    };
                    observers.push(result);
                    return result;
                },
                remove_observer: function(f) {
                    observers = _.without(observers, f);
                    return this;
                },
                add_observer: function(f) {
                    observers.push(f);
                    return this;
                }
            };
        }
    };
    d3.text(url + "/version", function(error, data) {
        if (error !== null) {
            alert("Error! It seems that there's no nanocube server on " + url);
            return;
        }
        if (error === null && data !== 'no handler found for /version (request key: version)') {
            result.version = data.slice(1, data.length-1);
        }
        
        d3.json(url + "/schema_json", function(error, data) {
            result.schema = data;
            var tbin = data.tbin;
            max_zoom = data.sbin;
            var s = tbin.split('_');
            var date = _.map(s[0].split('-'), Number);
            date[1] -= 1;
            var time = _.map(s[1].split(':'), Number);
            var tick_units = {
                "h": 3600 * 1000,
                "d": 3600 * 1000 * 24,
                "w": 3600 * 1000 * 24 * 7
            }[s[2][s[2].length-1]];
            if (_.isUndefined(tick_units))
                throw "Unrecognized tick unit in " + s[2];
            var ticks = Number(s[2].substr(0, s[2].length-1)) * tick_units;
            result.schema.time_schema = {
                epoch: new Date(date[0], date[1], date[2], time[0], time[1], time[2]),
                tick: ticks
            };
            opts.ready && opts.ready.call(result);
        });
    });
    return result;
};
