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
import mp = require("mongodb-promise");
import MongoClient = mp.MongoClient;
import mongodb = require("mongodb");
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
		col:<T>(collectionName:string) => Q.Promise<mp.Collection<T>>;
		find:(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => Q.Promise<any[]>;
		_find:<T>(array:T[], count?:number, sort?:{}, skip?:number, limit?:number, fields?:{}) => void;
		findOne:<T>(col:string, query:any, fields?:any) => Q.Promise<T>;
		_findOne:<T>(r:T) => void;
		_array:<T>(r:T[]) => void;
		insert:(col:string, op:any) => Q.Promise<InsertResult>;
		_insert:(r:InsertResult) => void;
		save:<T>(col:string, op:T) => Q.Promise<UpdateResult>;
		_save:<T>(r:UpdateResult) => void;
		update:(col:string, query:any, op:any, options?:any) => Q.Promise<UpdateResult>;
		_update:(r:UpdateResult) => void;
		remove:(col:string, op:any) => Q.Promise<UpdateResult>;
		_remove:(r:UpdateResult) => void;
		_ex: (ex:Error | {}) => void;
	
		_export:(data:any, name:string[]) => void;
		_exportInt:(data:any, name:string[]) => void;
	}
	interface Response extends express.Response {
		find:<T>(array:T[], count?:number, sort?:{}, skip?:number, limit?:number, fields?:{}) => void;
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
	private static conf:any
	static CGI(basepath: string, conf: any) {
		var domainCache:any = {}; // 执行域缓存
		this.conf = conf;
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
	}
	private _db: Q.Promise<mp.Db>; // 打开的mongodb的promise
	constructor(connection_string: string, username?: string, password?: string) {
		if (username && password) {
			console.log("connect_mongodb(" + [connection_string, username, "********"].join(", ") + ")");
		} else {
			console.log("connect_mongodb(" + connection_string + ")");
		}
		var defer = Q.defer<mp.Db>();
		this._db = defer.promise;

		MongoClient.connect(connection_string, {
			native_parser: !!mongodb.BSONNative,
			safe: true
		}).then(function(db:mp.Db) {
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
			opt.db = db._db;
			stub = _session(opt);
		});
		return (function() {
			if (stub) { stub.apply(this, [].slice.apply(arguments)); }
		});
	}
	mongodb() { // 向req中注入一些方便方法，并替换res的json方法，支持DBRef展开
		var self = this;
		// 替换express的json响应
		var _json = express.response.json;
		express.response.json = function _mongodb_json() {
			function replacer(indent: number, path: Array<string|number>, value: any) { // 实际展开值的函数
				//console.log("replacer", indent, path);
				if (typeof value !== "object" || !value) { return value; }
				var con = value.constructor;
				//console.log("replacer", con.name, con === ObjectID);
				var callee = arguments.callee,
					caller = callee.caller;
				if (Array.isArray(value)) { // Array
					var promises = Array<Q.Promise<any>>();
					(<Array<any>>value).forEach(function(v, i) {
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
					self.collection(value.namespace).then(function(col) {
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
			function replace(indent: number, path: Array<string|number>, obj: any) { // 决定哪些值应予展开的函数
				//console.log("replace", indent, path);
				if (typeof obj !== "object" || !obj || indent <= 0) { return obj; }
				if (!path) path = [];
				var promises = Array<any>(),
					defer = Q.defer<any>();
				if (Array.isArray(obj)) {
					var indexes = Array<number>(),
						resulta = Array<any>();
					(<Array<any>>obj).forEach(function(v, i) {
						indexes.push(i);
						var sub_path = path.slice();
						sub_path.push(i);
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
		return (<express.RequestHandler>function(req:Daemon.Request, res:Daemon.Response, next:Function) {
			// 自动注入某些通用参数（排序、分页等）
			req.col = self.collection.bind(self);
			req.find = function find<T>(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) {
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
				return self.collection<T>(col).then(function(collection) {
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
			req._find = res.find = function response_find<T>(array:T[], count?:number, sort?:{}, skip?:number, limit?:number, fields?:{}) {
				if (Array.isArray(array) && array.length === 6 && typeof count === "undefined")
					res.json({
						 $array: array[0],
						 $count: array[1],
						  $sort: array[2],
						  $skip: array[3],
						 $limit: array[4],
						$fields: array[5]
					});
				else if (arguments.length > 5)
					res.json({
						 $array: array,
						 $count: count,
						  $sort: sort,
						  $skip: skip,
						 $limit: limit,
						$fields: fields
					});
				else
					res.json(array);
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
			req.insert = function insert(col:string, op:{}) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.insert(op);
				});
			};
			req._insert = res.insert = function response_insert(r:{ ops:{}, result: { ok:number, n: number } }) {
				if (r.result)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.save = function save<T>(col:string, doc:T) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection<T>(col).then(function(collection) {
					return collection.save(doc);
				});
			};
			req.update = function update(col:string, query:{}, op:{}, options:{}) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.update(query, op, options);
				});
			};
			req.remove = function remove(col:string, query:{}) {
				if (typeof col !== "string") throw new Error("need collectionName");
				return self.collection(col).then(function(collection) {
					return collection.remove(query);
				});
			};
			req._remove = req._save = req._update = res.update = function response_update(r:{ result: { ok:number, n: number, nModified: number } }) {
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
				var __db: mp.Db;
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
				}).then(function(col:mp.Collection<{}>) {
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