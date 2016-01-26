/// <reference path="typings/tsd.d.ts" />
// node
import http = require("http");
import fs = require("fs");
import path = require("path");
import domain = require("domain");
import util = require('util');
var extend = util._extend;
// express
import express = require("express");
import bodyParser = require("body-parser");
import cookieParser = require("cookie-parser");
import session = require("express-session");
import cm = require('connect-mongo');
var MongoStore = cm(session);
import serveStatic = require('serve-static');

// mongodb & promise
import Q = require("q");
import mongodb = require("mongodb");
import MongoClient = mongodb.MongoClient;
import ObjectID = mongodb.ObjectID;
import DBRef = mongodb.DBRef;
// moment
import moment = require("moment");

declare module Daemon {
	interface SessionOptions {
		db: mongodb.Db;
		ttl: number;
		touchAfter: number; // 自动更新会话
		sessionSecret: string; // 会话密钥
		stringify: boolean;
	}

	interface UpdateResult {
		result: {
			ok:number,
			n: number,
			nInserted: number
			nMatched: number
			nModified: number
			nRemoved: number
			nUpserted: number
		}
	}
	interface InsertResult extends UpdateResult {
		ops: {}
	}
	interface Request extends express.Request {
		col:<T>(collectionName:string) => Q.Promise<mongodb.Collection<T>>;
		$find:any;
		find:<T>(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => Q.Promise<mongodb.Cursor<T>>;
		_find:<T>(cursor:mongodb.Cursor<T>) => void;
		findOne:<T>(col:string, query:any, fields?:any) => Q.Promise<T>;
		_findOne:<T>(r:T) => void;
		_array:<T>(r:T[]) => void;
		insert:(col:string, op:any, options?:{ safe?: any; continueOnError?: boolean; keepGoing?: boolean; serializeFunctions?: boolean; }) => Q.Promise<InsertResult>;
		_insert:(r:InsertResult) => void;
		save:<T>(col:string, op:T, options?:{ safe: any }) => Q.Promise<UpdateResult>;
		_save:<T>(r:UpdateResult) => void;
		update:(col:string, query:any, op:any, options?:{ safe?: boolean; upsert?: any; multi?: boolean; serializeFunctions?: boolean; }) => Q.Promise<UpdateResult>;
		_update:(r:UpdateResult) => void;
		remove:(col:string, op:any, options?:{ safe?: any; single?: boolean; }) => Q.Promise<UpdateResult>;
		_remove:(r:UpdateResult) => void;
		findAndModify:(col:string, query:any, sort:any[], op:any, options?:{ safe?: any; remove?: boolean; upsert?: boolean; new?: boolean; }) => Q.Promise<UpdateResult>;
		_ex: (ex:Error | {}) => void;
	
		_export:(data:any, name:string[]) => void;
		_exportInt:(data:any, name:string[]) => void;
	}
	interface Response extends express.Response {
		find:<T>(cursor:mongodb.Cursor<T>) => void;
		findOne:<T>(r:T) => void;
		array:<T>(r:T[]) => void;
		insert:(r:InsertResult) => void;
		update:(r:UpdateResult) => void;
		ex: (ex:Error | any) => void;
	}
	interface Route {
		(req: Request, res: Response, ...data:any[]): void;
	}
}

class Daemon {
	static r(route: Daemon.Route) { return route; }
	private conf: any;
	private _db: Q.Promise<mongodb.Db>; // 打开的mongodb的promise
	private _handlers: any; // 遗留的处理程序入口
	constructor(connection_string: string, username?: string, password?: string) {
		if (username && password) {
			console.log("connect_mongodb(" + [connection_string, username, "********"].join(", ") + ")");
		} else {
			console.log("connect_mongodb(" + connection_string + ")");
		}
		var self = this, defer = Q.defer<mongodb.Db>();
		self._db = defer.promise;
		self._handlers = {};
		MongoClient.connect(connection_string, {
			promiseLibrary: Q.Promise,
			native_parser: !!mongodb.BSONNative,
			safe: true
		}).then(function(db:mongodb.Db) {
			if (username && password) {
				db.authenticate(username, password)
				.then(function(result) {
					console.log("mc.authenticate() => ", result);
					if (result)
						defer.resolve(db);
					else
						defer.reject("username/password");
				}, function(err) {
					console.log("mc.authenticate() error:", err.errmsg);
					defer.reject(err);
				});
			} else {
				console.log("mc.connected()");
				defer.resolve(db);
			}
		}).done();
	}
	handlers(handlers:{}) {
		this._handlers = extend({}, handlers);
	}
	CGI(basepath: string, conf: any) {
		var self = this,
			domainCache:any = {}; // 执行域缓存
		self.conf = conf;
		function _exec(func: express.RequestHandler,
				req: express.Request,
				res: express.Response,
				next: Function) {
			var key = req.path,
				d: domain.Domain;
			if (!domainCache[key]) {
				d = domainCache[key] = domain.create();
				d.on("error", function(e:Error) {
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
		if (!/^\//.test(basepath)) {
			basepath = path.join(path.dirname(module.parent.filename), basepath); // 使用父模块的相对路径
		}
		return (<express.RequestHandler>function _CGI(req, res, next) {
			var absolute = path.join(basepath, req.path);
			if (absolute.indexOf(basepath) != 0) return res.status(500).send({ error: "out of jail" });
			try {
				var filename = require.resolve(absolute);
			} catch (e) {
				var handler = self._handlers[req.path];
				if (handler)
					return handler(req, res);
				else
					return res.status(404).send({ error: "module not found" });
			}
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
	}
	collection<T>(col:string) {
		if (typeof col !== "string") throw new Error("need collectionName");
		return this._db.then(function(db) { return db.collection<T>(col); });
	}
	session(options: Daemon.SessionOptions) {
		function _session(opt: Daemon.SessionOptions) {
			return session({
				secret: opt.sessionSecret,
				resave: true,
				saveUninitialized: true,
				store: new MongoStore(opt),
				cookie: { maxAge: opt.ttl * 1000 } // 会话有效期为30天
			});
		}
		var opt: Daemon.SessionOptions = {
			db: null,
			ttl: 30 * 24 * 60 * 60,
			touchAfter: 3600, // 每小时自动更新会话一次
			sessionSecret: "session secret",
			stringify: false
		};
		extend(opt, options);
		if (opt.db) { return _session(opt); }
		var stub:express.RequestHandler = null;
		this._db.then(function(db) {
			opt.db = db;
			stub = _session(opt);
		});
		return (function(req: express.Request,
				res: express.Response,
				next: Function) {
			if (stub) {
				stub.apply(this, [].slice.apply(arguments));
			} else {
				res.status(500).send("session not ready");
			}
		});
	}
	mongodb() { // 向req中注入一些方便方法，并替换res的json方法，支持DBRef展开
		var self = this;
		// 替换express的json响应
		var _json = express.response.json;
		express.response.json = function _mongodb_json(status:number, body?:any, options?:{ indent:number, fields: any, fieldsDefault: any }) {
			var resp = this,
				args = Array.prototype.slice.apply(arguments);
			if (typeof status === 'object') {
				options = body;
				body = status;
				status = null;
			}
			function replacer(indent: number, path: Array<string>, value: any) { // 实际展开值的函数
				//console.log("replacer", indent, path.join('.'));
				if (typeof value !== "object" || !value || indent < 0) { return value; }
				var con = value.constructor;
				//console.log("replacer", indent, con.name);
				var callee = arguments.callee,
					caller = callee.caller;
				if (Array.isArray(value)) { // Array
					var promises = Array<Q.Promise<any>>();
					(<Array<any>>value).forEach(function(v, i) {
						var sub_path = path.slice();
						sub_path.push('$');
						promises.push(callee(indent - 1, sub_path, v));
					});
					//console.log(promises);
					return Q.all(promises);
				} else if (con === String) {
					return value;
				} else if (con === Date) {
					return { $date: value.getTime() };
				} else if (con === ObjectID) { // ObjectID
					return { $id: value.toHexString() };
				} else if (con === DBRef) {
					var fields = options.fields[value.namespace];
					if (fields === false) { return value; }
					return self.collection(value.namespace)
					.then(function (col) {
						return col.findOne({ _id: value.oid }, fields || options.fieldsDefault);
					});
				} else {
					//console.log("replacer", con.name);
					//if (caller === replace) { return value; }
					return replace(indent - 1, path, value);
				}
			};
			function replace(indent: number, path: Array<string>, obj: any) { // 决定哪些值应予展开的函数
				//console.log("replace", indent, path.join('.'));
				if (typeof obj !== "object" || !obj || indent <= 0) { return Q(obj); }
				if (!path) path = [];
				var promises = Array<any>(),
					defer = Q.defer<any>();
				if (Array.isArray(obj)) {
					var indexes = Array<number>(),
						resulta = Array<any>();
					(<Array<any>>obj).forEach(function(v, i) {
						indexes.push(i);
						var sub_path = path.slice();
						sub_path.push('$');
						promises.push(replacer(indent - 1, sub_path, v));
					});
					Q.all(promises).then(function(values) {
						//console.log("replace resolve", keys);
						indexes.forEach(function(index, i) {
							resulta[index] = values[i];
						});
						defer.resolve(resulta);
					}).fail(function(err) {
						defer.reject(err);
					});
				} else {
					var keys = Array<string>(),
						resulto:any = {};
					for (var key in obj) {
						if (!obj.hasOwnProperty(key)) { continue; }
						keys.push(key);
						var sub_path = path.slice();
						sub_path.push(key);
						promises.push(replacer(indent - 1, sub_path, obj[key]));
					}
					Q.all(promises).then(function(values) {
						//console.log("replace resolve", keys);
						keys.forEach(function(key, i) {
							resulto[key] = values[i];
						});
						defer.resolve(resulto);
					}).fail(function(err) {
						defer.reject(err);
					});
				}
				return defer.promise;
			}
			options = extend({
				indent: 5,
				fields: {},
				fieldsDefault: { name: 1 }
			}, resp.$json$options, options);
			if (typeof body === 'object') {
				replace(options.indent, [], body).then(function (value:any) {
					if (status)
						resp.status(status);
					_json.apply(resp, [ value ]);
				});
			} else {
				if (status)
					resp.status(status);
				_json.apply(resp, [ body ]);
			}
		}
		return (<express.RequestHandler>function(req:Daemon.Request, res:Daemon.Response, next:Function) {
			// 自动注入某些通用参数（排序、分页等）
			req.col = self.collection.bind(self);
			req.find = function find<T>(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) {
				if (typeof col !== "string") throw new Error("need collectionName");
				var $find:any = req.$find = {},
					$query = $find.$query = query,
					$sort = $find.$sort = sort || req.query.$sort || req.body.$sort,
					$skip = $find.$skip = skip || req.query.$skip || req.body.$skip || 0,
					$limit = $find.$limit = limit || req.query.$limit || req.body.$limit || 20,
					$fields = $find.$fields = fields || req.query.$fields || req.body.$fields;
				if (typeof $skip === 'string')
					$find.$skip = parseInt($skip);
				if (typeof $limit === 'string')
					$find.$limit = parseInt($limit);
				switch (typeof $sort) {
				case "object":
					break;
				case "string":
					$find.$sort = {};
					$find.$sort[$sort] = 1;
					break;
				default:
					$sort = { _id: 1 };
				}
				return self.collection<T>(col).then(function(collection) {
					var cursor = collection.find($query || {}, $fields || {});
					cursor.sort($find.$sort);
					cursor.skip($find.$skip);
					cursor.limit($find.$limit);
					return cursor;
				});
			};
			req._find = res.find = function response_find<T>(cursor:mongodb.Cursor<T>) {
				if (req.$find) {
					var $find = req.$find;
					return Q.all([
						cursor.toArray(),
						cursor.count(),
						$find.$sort,
						$find.$skip,
						$find.$limit,
						$find.$fields
					]).spread(function(array:T[], count?:number, sort?:{}, skip?:number, limit?:number, fields?:{}) {
						res.json({
							$array: array,
							$count: count,
							$sort: sort,
							$skip: skip,
							$limit: limit,
							$fields: fields
						});
					});
				} else if (cursor instanceof mongodb.Cursor) {
					cursor.toArray().then(function(array:T[]) {
						res.json(array);
					});
				} else {
					res.json(cursor);
				}
			};
			req.findOne = function findOne<T>(col:string, query:{}, fields?:{}) {
				if (typeof col !== "string") throw new Error("need collectionName");
				var $fields = req.query.$fields || req.body.$fields;
				return self.collection<T>(col).then(function(collection) {
					return collection.findOne(query || {}, fields || $fields || {});
				});
			};
			req._array = req._findOne = res.array = res.findOne = function response_one<T>(r:T|T[]) {
				res.json(r);
			};
			req.insert = function insert(col, op, options) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.insert(op, options);
				});
			};
			req._insert = res.insert = function response_insert(r:{ ops:{}, result: { ok:number, n: number } }) {
				if (r.result)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.save = function save<T>(col:string, op:T, options?:{ safe: any }) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.save(op, options);
				});
			};
			req.update = function update(col, query, op, options) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.update(query, op, options);
				});
			};
			req.remove = function remove(col, query, options) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.remove(query, options);
				});
			};
			req._remove = req._save = req._update = res.update = function response_update(r:{ result: { ok:number, n: number, nModified: number } }) {
				if (r.result)
					res.json({ ok: r.result.ok, nModified: r.result.nModified, n: r.result.n });
				else
					res.json(r);
			};
			req.findAndModify = function findAndModify(col, query, sort, op, options) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.findAndModify(query, sort, op, options);
				});
			};
			// 匹配输出的方便方法
			req._ex = res.ex = function response_ex(ex) {
				res.status(500).json(ex.message ? { message: ex.message, stack: ex.stack } : { ex: ex });
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
			next();
		});
	}
	_moment(exp:string|number): moment.Moment { // 将输入的参数转化为moment类型的值
		var exp0: number, m:moment.Moment;
		if (typeof exp === 'string' && /^\d+$/.test(exp))
			exp0 = parseInt(exp);
		else if (typeof exp === 'number')
			exp0 = exp;
		else
			return null;
		m = moment(exp);
		return m.isValid() ? m : null;
	}
	// 混合式验证
	private whitelist: string[] // IP 白名单
	whitelist_add(ip:string) {
		this.whitelist.push(ip);
	}
	private basic: string[] // 用户名密码
	basic_add(username:string, password:string) {
		this.basic.push("Basic " + new Buffer(username + ":" + password).toString("base64"));
	}
	realm = "Authentication Zone"
	hybrid_auth(realm:string) {
		var self = this;
		if (realm) { self.realm = realm; }
		return (<express.RequestHandler>function _hybrid_auth(req, res, next) { // 混合式验证，支持IP白名单和用户名密码
			function _reject() {
				res.set("WWW-Authenticate", "Basic realm=\"" + self.realm + "\"");
				res.sendStatus(401);
			}
			var ip = req.headers["x-real-ip"],
				auth = req.headers["authorization"];
			if (self.whitelist.indexOf(ip) >= 0 // IP 白名单
					|| self.basic.indexOf(auth) >= 0) { // 用户名密码
				next();
			} else if (self._db) {
				var __db: mongodb.Db;
				self._db.then(function(db) {
					__db = db;
					return __db.collection("hybrid_ip_whitelist");
				}).then(function(col) {
					return col.findOne({ ip: ip });
				}).then(function(record) {
					if (record) {
						next(); // 短路
						return Q.reject(record);
					}
					return __db.collection<{}>("hybrid_authorization");
				}).then(function(col:mongodb.Collection<{}>) {
					return col.findOne({ auth: auth });
				}).then(function(record) {
					if (record) {
						next(); // 短路
						return Q.reject(record);
					}
					_reject();
				}).done();
			} else {
				_reject();
			}
		});
	}
}

export = Daemon;
