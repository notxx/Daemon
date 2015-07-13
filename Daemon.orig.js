/// <reference path="typings/tsd.d.ts" />
// node
var http = require("http"),
	fs = require("fs"),
	path = require("path"),
	domain = require("domain"),
	extend = require('util')._extend;
// express
var express = require("express"),
	bodyParser = require("body-parser"),
	cookieParser = require("cookie-parser"),
	session = require("express-session"),
	MongoStore = require('connect-mongo')(session),
	serveStatic = require('serve-static');

// mongodb & promise
var Q = require("q"),
	mp = require("mongodb-promise"),
	MongoClient = mp.MongoClient,
	mongodb = require("mongodb"),
	ObjectID = mongodb.ObjectID,
	DBRef = mongodb.DBRef;
// moment
var moment = require("moment");

var Daemon = function connect_mongodb( // 连接数据库
		connection_string, // 数据库链接字符串
		username, // 用户名
		password) { // 密码
	if (!connection_string) { throw new Error("need connection_string"); }
	if (username && password) {
		console.log("connect_mongodb(" + [connection_string, username, "********"].join(", ") + ")");
	} else {
		console.log("connect_mongodb(" + connection_string + ")");
	}
	var defer = Q.defer();
	this._db = defer.promise;

	MongoClient.connect(connection_string, {
		native_parser: !!mongodb.BSONNative,
		safe: true
	}).then(function(db) {
		if (username && password) {
			db.authenticate(username, password)
			.then(function(result) {
				console.log("mc.authenticate() => ", result);
				if (result)
					defer.resolve(db);
				else
					defer.reject();
			}, function(err) {
				console.log("mc.authenticate() error:", err.errmsg);
				defer.reject(err);
			});
		} else {
			console.log("mc.connected()");
			defer.resolve(db);
		}
	}).done();
};
Daemon.prototype = {
	_db: null, // 打开的mongodb的promise
};
Daemon.prototype.session = function _session_route(options) {
	function _session(opt) {
		return session({
			secret: opt.sessionSecret,
			resave: true,
			saveUninitialized: true,
			store: new MongoStore(opt),
			cookie: { maxAge: opt.ttl * 1000 } // 会话有效期为30天
		});
	}
	var opt = {
		db: null,
		ttl: 30 * 24 * 60 * 60,
		touchAfter: 3600, // 每小时自动更新会话一次
		sessionSecret: "session secret",
		stringify: false
	};
	extend(opt, options);
	if (opt.db) { return _session(opt); }
	var stub = null;
	this._db.then(function(db) {
		opt.db = db._db;
		stub = _session(opt);
	});
	return (function() {
		if (stub) { stub.apply(this, [].slice.apply(arguments)); }
	});
};
Daemon.prototype.collection = function collection(col) {
	if (typeof col !== "string") throw new Error("need collectionName");
	return this._db.then(function(db) { return db.collection(col) });
};
Daemon.prototype.mongodb = function _mongodb_route() { // 向req中注入一些方便方法，并替换res的json方法，支持DBRef展开
	var self = this, promise = self._db;
	// 替换express的json响应
	var _json = express.response.json;
	express.response.json = function _mongodb_json() {
		function replacer(indent, path, value) { // 实际展开值的函数
			//console.log("replacer", indent, path);
			if (typeof value !== "object" || !value) { return value; }
			var con = value.constructor;
			//console.log("replacer", con.name, con === ObjectID);
			var caller = arguments.caller,
				callee = arguments.callee;
			if (Array.isArray(value)) { // Array
				var promises = [];
				value.forEach(function(v, i) {
					var sub_path = path.slice();
					sub_path.push(i);
					promises.push(callee(indent, sub_path, v));
				});
				//console.log(promises);
				return Q.all(promises);
			} else if (con === Date) {
				return { $date: value.getTime() };
			} else if (con === ObjectID) { // ObjectID
				return { $id: value.toHexString() };
			} else if (con === DBRef) {
				var defer = Q.defer();
				promise.then(function(db) {
					return db.collection(value.namespace);
				}).then(function(col) {
					var columns = { name: 1 };
					switch (value.namespace) {
					case 'operator':
						columns = { name: 1, id: 1, mobile: 1, phone: 1 };
						break;
					}
					return col.findOne({ _id: value.oid }, columns);
				}).then(function(obj) {
					defer.resolve(obj);
				}).fail(function(err) {
					defer.reject(err);
				});
				return defer.promise;
			} else {
				//console.log("replacer", con.name);
				if (caller === replace) { return value; }
				return replace(indent - 1, path, value);
			}
		};
		function replace(indent, path, obj) { // 决定哪些值应予展开的函数
			//console.log("replace", indent, path);
			if (typeof obj !== "object" || !obj || indent <= 0) { return obj; }
			if (!path) path = [];
			var keys = [],
				promises = [];
			for (var key in obj) {
				if (!obj.hasOwnProperty(key)) { continue; }
				keys.push(key);
				var sub_path = path.slice();
				sub_path.push(key);
				promises.push(replacer(indent - 1, sub_path, obj[key]));
			}
			var defer = Q.defer(), result = Array.isArray(obj) ? [] : {};
			Q.all(promises).then(function(values) {
				//console.log("replace resolve", keys);
				keys.forEach(function(key, i) {
					result[key] = values[i];
				});
				defer.resolve(result);
			}).fail(function(err) {
				defer.reject(err);
			});
			return defer.promise;
		}
		var vo = this, args = Array.prototype.slice.apply(arguments);
		if (args.length == 0) {
			_json.apply(vo, args);
		} else if (typeof args[0] === "object") {
			Q(replace(3, null, args[0])).done(function(value) {
				args[0] = value;
				_json.apply(vo, args);
			});
		} else if (typeof args[1] === "object") {
			Q(replace(3, null, args[1])).done(function(value) {
				args[1] = value;
				_json.apply(vo, args);
			});
		} else {
			_json.apply(vo, args);
		}
	}
	return (function(req, res, next) {
		// 自动注入某些通用参数（排序、分页等）
		req.col = self.collection.bind(self);
		req.find = function find(col, query, fields, sort, skip, limit) {
			if (typeof col !== "string") throw new Error("need collectionName");
			var $sort = req.query.$sort || req.body.$sort,
				$skip = req.query.$skip || req.body.$skip || 0,
				$limit = req.query.$limit || req.body.$limit || 20,
				$fields = req.query.$fields || req.body.$fields;
			$skip = parseInt($skip);
			$limit = parseInt($limit);
			switch (typeof $sort) {
			case "object":
				break;
			case "string":
				var t = $sort;
				$sort = {};
				$sort[t] = 1;
				break;
			default:
				$sort = { _id: 1 };
			}
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				var cursor = collection.find(query || {}, fields || $fields || {});
				cursor.sort(sort || $sort);
				cursor.skip(skip || $skip);
				cursor.limit(limit || $limit);
				return Q.all([
					cursor.toArray(),
					cursor.count(),
					sort || $sort,
					skip || $skip,
					limit || $limit,
					fields || $fields
				]);
			});
		};
		req._find = res.find = function response_find(r) {
			if (Array.isArray(r) && r.length > 5)
				res.json({
					 $array: r[0],
					 $count: r[1],
					  $sort: r[2],
					  $skip: r[3],
					 $limit: r[4],
					$fields: r[5]
				});
			else if (arguments.length > 5)
				res.json({
					 $array: arguments[0],
					 $count: arguments[1],
					  $sort: arguments[2],
					  $skip: arguments[3],
					 $limit: arguments[4],
					$fields: arguments[5]
				});
			else
				res.json(r);
		};
		req.findOne = function findOne(col, query, fields) {
			if (typeof col !== "string") throw new Error("need collectionName");
			var $fields = req.query.$fields || req.body.$fields;
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				return collection.findOne(query || {}, fields || $fields || {});
			});
		};
		req._array = req._findOne = res.array = res.findOne = function response_one(r) {
			res.json(r);
		};
		req.insert = function insert(col, op) {
			if (typeof col !== "string") throw new Error("need collectionName");
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				return collection.insert(op);
			});
		};
		req._insert = res.insert = function response_insert(r) {
			if (r.result)
				res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
			else
				res.json(r);
		};
		req.save = function save(col, op) {
			if (typeof col !== "string") throw new Error("need collectionName");
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				return collection.save(op);
			});
		};
		req.update = function update(col, query, op, options) {
			if (typeof col !== "string") throw new Error("need collectionName");
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				return collection.update(query, op, options);
			});
		};
		req.remove = function remove(col, query) {
			if (typeof col !== "string") throw new Error("need collectionName");
			return promise.then(function(db) { return db.collection(col); })
			.then(function(collection) {
				return collection.remove(query);
			});
		};
		req._remove = req._save = req._update = res.update = function response_update(r) {
			if (r.result)
				res.json({ ok: r.result.ok, nModified: r.result.nModified, n: r.result.n });
			else
				res.json(r);
		};
		// 将参数复制到对象
		req._export = function request_export(data, names) {
			names.forEach(function(name) {
				data[name] = req.query[name] || req.body[name];
			})
		};
		req._exportInt = function request_export_int(data, names) {
			names.forEach(function(name) {
				data[name] = parseInt(req.query[name] || req.body[name]);
			})
		};
		// 匹配输出的方便方法
		req._ex = res.ex = function response_ex(ex) {
			res.status(500).json({ message: ex.message, stack: ex.stack });
		};
		next();
	});
};
// CGI
Daemon.CGI = function CGI(basepath, conf) {
	var domainCache = {}; // 执行域缓存
	this.conf = conf;
	function _exec(func, req, res, next) {
		var key = req.path, d;
		if (!domainCache[key]) {
			d = domainCache[key] = domain.create();
			d.on("error", function(e) {
				res.status(500).send({ error: e.message });
			});
		} else {
			d = domainCache[key];
		}
		d.run(function() {
			if (conf[key]) {
				func.call(conf[key], req, res, next);
			} else {
				func(req, res, next);
			}
		});
	}
	return (function _CGI(req, res, next) {
		var absolute = path.join(basepath, req.path);
		if (absolute.indexOf(basepath) != 0) return res.status(500).send({ error: "out of jail" });
		absolute = "./" + absolute;
		try {
			var filename = require.resolve(absolute);
		} catch (e) { return res.status(404).send({ error: "module not found" }); }
		var module = require.cache[filename];
		if (module) { return _exec(module.exports, req, res, next); }
		var watcher = fs.watch(filename, { persistent: false });
		watcher.on("change", function() {
			console.log("unload " + filename);
			watcher.close();
			if (module && module.parent) {
				module.parent.children.splice(module.parent.children.indexOf(module), 1);
			}
			delete require.cache[filename];
		});
		_exec(require(absolute), req, res, next);
		console.log("load " + filename);
	});
};
// 混合式验证
Daemon.hybrid_auth = Daemon.prototype.hybrid_auth = function hybrid_auth(realm) {
	var self;
	if (this instanceof Daemon) {
		self = {};
	} else {
		self = this;
		this.ip_whitelist = [];
		this.basic_auth = [];
	}
	if (realm) { self.realm = realm; }
	return (function _hybrid_auth(req, res, next) { // 混合式验证，支持IP白名单和用户名密码
		function _reject() {
			res.set("WWW-Authenticate", "Basic realm=\"" + self.realm + "\"");
			res.sendStatus(401);
		}
		var ip = req.headers["x-real-ip"],
			auth = req.headers["authorization"];
		if (self.ip_whitelist.indexOf(ip) >= 0 // IP 白名单
				|| self.basic_auth.indexOf(auth) >= 0) { // 用户名密码
			next();
		} else if (self._db) {
			var __db;
			self._db.then(function(db) {
				__db = db;
				return __db.collection("hybrid_ip_whitelist");
			}).then(function(col) {
				return col.findOne({ ip: ip });
			}).then(function(record) {
				if (record) {
					next();
					return Q.reject(record);
				}
				return __db.collection("hybrid_authorization");
			}).then(function(col) {
				return col.findOne({ auth: auth });
			}).then(function(record) {
				if (record) {
					next();
					return Q.reject(record);
				}
				_reject();
			}).done();
		} else {
			_reject();
		}
	});
};
Daemon.hybrid_auth.prototype = {
	whitelist: null, // IP 白名单
	whitelist_add: function(ip) {
		this.whitelist.push(ip);
	},
	basic: null, // 用户名密码
	basic_add: function(username, password) {
		this.basic.push("Basic " + new Buffer(username + ":" + password).toString("base64"));
	},
	realm: "Authentication Zone"
};
var _moment = Daemon._moment = function _moment(exp) { // 将输入的参数转化为moment类型的值
	if (/^\d+$/.test(exp)) exp = parseInt(exp);
	exp = moment(exp);
	return exp.isValid() ? exp : null;
};
module.exports = Daemon;
