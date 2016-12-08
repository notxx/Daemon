// node
import * as fs from "fs"
import * as path from "path"
import * as domain from "domain"
import * as util from "util"
import * as cluster from "cluster"
// express
/// <reference path="../typings/tsd.d.ts" />
import * as express from "express"
import * as session from "express-session"
import * as cm from "connect-mongo"
let MongoStore = cm(session);

// mongodb
/** @interal */
declare global {
	interface Promise<T> {
		spread<TResult1, TResult2>(onfulfilled: (...values: any[]) => TResult1 | PromiseLike<TResult1>,
			onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2>
	}
}
Promise.prototype.spread = function spread<TResult1, TResult2>(onfulfilled: (...values: Array<any>) => TResult1 | PromiseLike<TResult1>,
		onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>) {
	return this.then((result:any) => {
		if (Array.isArray(result)) {
			onfulfilled.apply(this, result);
		} else {
			onfulfilled.call(this, result);
		}
	}, onrejected);
};

function extend(origin:any, add:any): any {
	// Don't do anything if add isn't an object
	if (add === null || typeof add !== 'object') return origin;

	let keys = Object.keys(add);
	let i = keys.length;
	while (i--) {
		origin[keys[i]] = add[keys[i]];
	}
	return origin;
}
// Promise.prototype.then;
import * as mongodb from "mongodb"
import MongoClient = mongodb.MongoClient
// moment
import * as moment from "moment"

declare module Daemon {
	interface SessionOptions {
		db: mongodb.Db;
		ttl: number;
		touchAfter: number; // 自动更新会话
		sessionSecret: string; // 会话密钥
		stringify: boolean;
	}

	interface Request extends express.Request {
		col:(collectionName:string) => Promise<mongodb.Collection>;
		$find:any;
		find:(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => Promise<mongodb.Cursor>;
		_find:(cursor:mongodb.Cursor) => void;
		findOne:<T>(col:string, query:any, fields?:any) => Promise<T>;
		_findOne:<T>(r:T) => void;
		_array:<T>(r:T[]) => void;
		insert:(col:string, op:any, options?: mongodb.CollectionInsertOneOptions) => Promise<mongodb.WriteOpResult>;
		_insert:(r:mongodb.WriteOpResult) => void;
		insertMany:(col:string, docs:any[], options?: mongodb.CollectionInsertManyOptions) => Promise<mongodb.WriteOpResult>;
		save:(col:string, op:any, options?: mongodb.CollectionOptions) => Promise<mongodb.WriteOpResult>;
		_save:(r:mongodb.WriteOpResult) => void;
		update:(col:string, query:any, op:any, options?: mongodb.ReplaceOneOptions & { multi?: boolean; }) => Promise<mongodb.WriteOpResult>;
		_update:(r:mongodb.WriteOpResult) => void;
		remove:(col:string, query:any, options?: mongodb.CollectionOptions & { single?: boolean; }) => Promise<mongodb.WriteOpResult>;
		_remove:(r:mongodb.WriteOpResult) => void;
		findAndUpdate:(col:string, query:any, op:any, options?:mongodb.FindOneAndReplaceOption) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
		_ex: (ex:Error | {}) => void;
	
		_export:(data:any, name:string[]) => void;
		_exportInt:(data:any, name:string[]) => void;
	}
	interface Response extends express.Response {
		find:<T>(cursor:mongodb.Cursor) => void;
		findOne:<T>(r:T) => void;
		array:<T>(r:T[]) => void;
		insert:(r:mongodb.InsertOneWriteOpResult) => void;
		insertMany:(r:mongodb.InsertWriteOpResult) => void;
		update:(r:mongodb.WriteOpResult) => void;
		ex: (ex:Error | any) => void;
		$json$options: any;
	}
	interface Route {
		(req: Request, res: Response, ...data:any[]): void;
	}
}
interface Daemon {
	CGI(path: string, conf?: {}): void
	collection(col:string): Promise<mongodb.Collection>
	session(options: Daemon.SessionOptions): express.RequestHandler
	mongodb(): express.RequestHandler
	_moment(exp:string|number): moment.Moment
}

const rootpath = path.dirname(module.parent.filename); // 使用父模块的相对路径

class Daemon {
	static _require(id:string):any {
		if (!id) throw new TypeError("null id");
		let filename = require.resolve(id);
		let module = require.cache[filename];
		if (module) return module.exports;
		let watcher = fs.watch(filename, { persistent: false });
		watcher.once("change", () => {
			console.log("unload %s(%s)", id, filename);
			watcher.close();
			if (module && module.parent) {
				module.parent.children.splice(module.parent.children.indexOf(module), 1);
			}
			delete require.cache[filename];
		});
		console.log("load %s(%s)", id, filename);
		return require(id);
	}
	static require(id: string):any {
		if (!id) throw new TypeError("null id");
		if (id.startsWith(".")) {
			id = path.join(rootpath, id);
			if (!id.startsWith(rootpath)) throw new TypeError("module out of jail");
		}
		return this._require(id);
	}             
	private _db: Promise<mongodb.Db>; // 打开的mongodb的promise
	private _handlers: any; // 遗留的处理程序入口
	constructor(connection_string: string, username?: string, password?: string) {
		if (username && password) {
			console.log(`connect_mongodb(${connection_string}, ${username}, ********)`);
		} else {
			console.log(`connect_mongodb(${connection_string})`);
		}
		this._db = new Promise((resolve, reject) => {
			MongoClient.connect(connection_string, {
				promiseLibrary: Promise,
			}).then((db:mongodb.Db) => {
				if (username && password) {
					db.authenticate(username, password)
					.then(result => {
						console.log("mc.authenticate() => ", result);
						if (result)
							resolve(db);
						else
							reject("username/password");
					}, err => {
						console.log("mc.authenticate() error:", err.errmsg);
						reject(err);
					});
				} else {
					console.log("mc.connected()");
					resolve(db);
				}
			});
		});
		this._handlers = {};
	}
	handlers(handlers:{}) {
		this._handlers = extend({}, handlers);
	}
	private conf: any;
	CGI(basepath: string, conf: any) {
		let domainCache:any = {}; // 执行域缓存
		this.conf = conf;
		function _exec(func: express.RequestHandler,
				req: express.Request,
				res: express.Response,
				next: Function) {
		}
		if (!/^\//.test(basepath)) {
			basepath = path.join(rootpath, basepath); // 使用父模块的相对路径
			if (basepath.indexOf(rootpath) != 0) throw new TypeError("basepath out of jail");
		}
		return ((req:express.Request, res:express.Response, next:Function) => {
			let absolute = path.join(basepath, req.path);
			if (absolute.indexOf(basepath) != 0) return res.status(500).send({ error: "web-module out of jail" });
			try {
				require.resolve(absolute);
			} catch (e) {
				let handler = this._handlers[req.path];
				if (handler)
					return handler(req, res);
				else
					return res.status(404).send({ error: "module not found" });
			}
			let key = req.path,
				d: domain.Domain;
			if (!domainCache[key]) {
				d = domainCache[key] = domain.create();
				d.on("error", (e:Error) => {
					res.status(500).send({ error: e.message });
				});
			} else {
				d = domainCache[key];
			}
			d.run(() => Daemon._require(absolute).call(conf[key] || this, req, res, next));
		});
	}
	hot(id:string) {
	}
	collection(col:string) {
		if (typeof col !== "string") throw new Error("need collectionName");
		return this._db.then((db) => db.collection(col));
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
		let opt: Daemon.SessionOptions = {
			db: null,
			ttl: 30 * 24 * 60 * 60,
			touchAfter: 3600, // 每小时自动更新会话一次
			sessionSecret: "session secret",
			stringify: false
		};
		extend(opt, options);
		if (opt.db) { return _session(opt); }
		let stub:express.RequestHandler = null;
		this._db.then((db) => {
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
		// 替换express的json响应
		let daemon = this,
			_json = express.response.json;
		express.response.json = function json(status:number, body?:any, options?:{ indent:number, fields: any, fieldsDefault: any }) {
			let replacer = (indent: number, path: Array<string>, value: any) => { // 实际展开值的函数
				//console.log("replacer", indent, path.join('.'));
				if (typeof value !== "object" || !value || indent < 0) { return value; }
				if (Array.isArray(value)) { // Array
					let promises = Array<Promise<any>>();
					(<Array<any>>value).forEach((v, i) => {
						let sub_path = path.slice();
						sub_path.push('$');
						promises.push(replacer(indent - 1, sub_path, v));
					});
					//console.log(promises);
					return Promise.all(promises);
				} else if (typeof value === "string") {
					return value;
				} else if (value instanceof Date) {
					return { $date: value.getTime() };
				} else if (value.toHexString) { // ObjectID
					return { $id: value.toHexString() };
				} else if (value.namespace && value.oid) {
					let fields = options.fields[value.namespace];
					if (fields === false) { return value; }
					return daemon.collection(value.namespace)
					.then((col) => {
						return col.findOne({ _id: value.oid }, fields || options.fieldsDefault);
					});
				} else {
					//console.log("replacer", con.name);
					return replace(indent - 1, path, value);
				}
			};
			let replace = (indent: number, path: Array<string>, obj: any) => { // 决定哪些值应予展开的函数
				//console.log("replace", indent, path.join('.'));
				if (typeof obj !== "object" || !obj || indent <= 0) { return Promise.resolve(obj); }
				if (!path) path = [];
				let promises = Array<any>(),
					promise:Promise<any>;
				if (Array.isArray(obj)) {
					let indexes = Array<number>(),
						resulta = Array<any>();
					(<Array<any>>obj).forEach((v, i) => {
						indexes.push(i);
						let sub_path = path.slice();
						sub_path.push('$');
						promises.push(replacer(indent - 1, sub_path, v));
					});
					promise = new Promise((resolve, reject) => {
						Promise.all(promises).then((values) => {
							//console.log("replace resolve", keys);
							indexes.forEach((index, i) => {
								resulta[index] = values[i];
							});
							resolve(resulta);
						}, reject);
					});
				} else {
					let keys = Array<string>(),
						resulto:any = {};
					for (let key in obj) {
						if (!obj.hasOwnProperty(key)) { continue; }
						keys.push(key);
						let sub_path = path.slice();
						sub_path.push(key);
						promises.push(replacer(indent - 1, sub_path, obj[key]));
					}
					promise = new Promise((resolve, reject) => {
						Promise.all(promises).then((values) => {
							//console.log("replace resolve", keys);
							keys.forEach((key, i) => {
								resulto[key] = values[i];
							});
							resolve(resulto);
						}, reject);
					});
				}
				return promise;
			}

			let resp: Daemon.Response = this;
			if (typeof status === 'object') {
				options = body;
				body = status;
				status = null;
			}
			options = extend({
				indent: 5,
				fields: {},
				fieldsDefault: { name: 1 }
			}, options);
			options = extend(resp.$json$options, options);
			if (typeof body === 'object') {
				replace(options.indent, [], body).then((value:any) => {
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
		return ((req:Daemon.Request, res:Daemon.Response, next:Function) => {
			// 自动注入某些通用参数（排序、分页等）
			req.col = daemon.collection.bind(this);
			req.find = (col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				let $find:any = req.$find = {},
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
				return daemon.collection(col).then((collection) => collection.find($query || {}, $fields || {}, $find.$sort, $find.$skip, $find.$limit));
			};
			req._find = res.find = (cursor: mongodb.Cursor) => {
				if (req.$find) {
					let $find:{ $sort:any, $skip:number, $limit:number, $fields:any } = req.$find;
					return Promise.all([
						cursor.toArray(),
						cursor.count(false),
						$find.$sort,
						$find.$skip,
						$find.$limit,
						$find.$fields
					]).spread((array:any, count:any, sort:any, skip:any, limit:any, fields:any) => {
						res.json({
							$array: array,
							$count: count,
							$sort: sort,
							$skip: skip,
							$limit: limit,
							$fields: fields
						});
					});
				} else if (cursor.toArray) {
					cursor.toArray().then(array => res.json(array));
				} else {
					res.json(cursor);
				}
			};
			req.findOne = (col:string, query:{}, fields?:{}) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				let $fields = req.query.$fields || req.body.$fields;
				return daemon.collection(col).then((collection) => {
					return collection.findOne(query || {}, fields || $fields || {});
				});
			};
			req._array = req._findOne = res.array = res.findOne = (r:any) => {
				res.json(r);
			};
			req.insert = (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => {
					return collection.insert(op, options);
				});
			};
			req._insert = res.insert = r => {
				if (r.result)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.insertMany = (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.insertMany(op, options));
			};
			res.insertMany = r => {
				if (r.result && r.ops)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.save = (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.save(op, options));
			};
			req.update = (col, query, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.update(query, op, options));
			};
			req.remove = (col, query, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.remove(query, options));
			};
			req._remove = req._save = req._update = res.update = r => {
				let result = r.result;
				if (result)
					res.json({ ok: result.ok, nModified: result.nModified, n: result.n });
				else
					res.json(r);
			};
			req.findAndUpdate = (col, query, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.findOneAndUpdate(query, op, options));
			};
			// 匹配输出的方便方法
			req._ex = res.ex = (ex) => {
				res.status(500).json(ex.message ? { message: ex.message, stack: ex.stack } : { ex: ex });
			};
			// 将参数复制到对象
			req._export = (data, names) => {
				names.forEach((name) => {
					data[name] = req.query[name] || req.body[name];
				})
			};
			req._exportInt = (data, names) => {
				names.forEach((name) => {
					data[name] = parseInt(req.query[name] || req.body[name]);
				})
			};
			next();
		});
	}
	_moment(exp:string|number): moment.Moment { // 将输入的参数转化为moment类型的值
		let exp0: number, m:moment.Moment;
		if (typeof exp === 'string' && /^\d+$/.test(exp))
			exp0 = parseInt(exp);
		else if (typeof exp === 'number')
			exp0 = exp;
		else
			return null;
		m = moment(exp);
		return m.isValid() ? m : null;
	}
}

export = Daemon;
