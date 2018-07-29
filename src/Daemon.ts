// node
import * as fs from "fs"
import * as path from "path"
import * as domain from "domain"
import * as cluster from "cluster"
// express
/// <reference path="../typings/tsd.d.ts" />
import * as express from "express"
import * as session from "express-session"
import * as cm from "connect-mongo"
let MongoStore = cm(session);

// Promise
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
			return onfulfilled.apply(this, result);
		} else {
			return onfulfilled.call(this, result);
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

// mongodb
import * as mongodb from "mongodb"
import MongoClient = mongodb.MongoClient
import Db = mongodb.Db

// moment
import * as moment from "moment"

declare module Daemon {
	interface SessionOptions extends cm.DefaultOptions {
		sessionSecret: string; // 会话密钥
		db?: Db;
		dbPromise?: Promise<Db>;
	}
	interface MongoSessionOptions extends SessionOptions, cm.NativeMongoOptions {
		db: Db;
	}
	interface MongoPromiseSessionOptions extends SessionOptions, cm.NativeMongoPromiseOptions {
		dbPromise: Promise<Db>;
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
		save:(col:string, op:any, options?: mongodb.CommonOptions) => Promise<mongodb.WriteOpResult>;
		_save:(r:mongodb.WriteOpResult) => void;
		update:(col:string, query:any, op:any, options?: mongodb.ReplaceOneOptions & { multi?: boolean; }) => Promise<mongodb.WriteOpResult>;
		_update:(r:mongodb.WriteOpResult) => void;
		remove:(col:string, query:any, options?: mongodb.CommonOptions & { single?: boolean; }) => Promise<mongodb.WriteOpResult>;
		_remove:(r:mongodb.WriteOpResult) => void;
		findOneAndDelete:(col:string, filter:Object, options: { projection?: Object, sort?: Object, maxTimeMS?: number }) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
		findOneAndReplace:(col:string, filter:Object, replacement:Object, options?:mongodb.FindOneAndReplaceOption) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
		findOneAndUpdate:(col:string, filter:Object, update:Object, options?:mongodb.FindOneAndReplaceOption) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
		bucket:(bucketName:string) => Promise<mongodb.GridFSBucket>;
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
	session(options: (Daemon.MongoSessionOptions | Daemon.MongoPromiseSessionOptions)): express.RequestHandler
	mongodb(): express.RequestHandler
	_moment(exp:string|number): moment.Moment
}
enum Event {
	Load,
	Unload
}
interface Message {
	daemon: boolean
	event: Event
	id: string
	filename: string
}

const rootpath = module.parent
		? path.dirname(module.parent.filename) // 使用父模块的相对路径
		: __dirname;
		
class Daemon {
	static _init() {
		// console.log("_init");
		if (cluster.isMaster)
			cluster.on("online", worker=>{ // TODO
				// console.log("worker online");
				worker.on("message", message=>this._broadcast_message(worker, <Message>message));
			});
		else if (cluster.isWorker)
			cluster.worker.on("message", message=>this._onmessage(<Message>message));
	}
	private static _broadcast_message(source:cluster.Worker, message:Message) {
		// console.log(`_broadcast_message ${source} ${message})`);
		for (let id in cluster.workers) {
			let worker = cluster.workers[id];
			if (worker === source) continue;
			worker.send(message);
		}
	}
	private static _onmessage(message:Message) {
		// console.log(`_onmessage ${message})`);
		if (!message.daemon) return;
		switch(message.event) {
		case Event.Load:
			require(message.id);
			this._watch(message.id, message.filename);
			break;
		case Event.Unload:
			this._unload(message);
			break;
		}
	}
	private static _watch(id:string, filename:string) {
		let watcher = fs.watch(filename, { persistent: false });
		watcher.once("change", () => {
			watcher.close();
			this._triggerunload(id, filename);
		});
	}
	private static _unload(message:Message) {
		let m = require.cache[message.filename];
		if (m) {
			if (m.parent) { m.parent.children.splice(m.parent.children.indexOf(m), 1); }
			delete require.cache[message.filename];
		}
	}
	private static _trigger(message:Message) {
		// console.log(`_trigger ${message})`);
		message.daemon = true;
		if (cluster.isWorker) {
			process.send(message);
		}
	}
	/** 触发模块载入事件. */
	private static _triggerload(id:string, filename:string) {
		console.log(`load ${id.replace(rootpath, ".")}(${filename.replace(rootpath, ".")})`);
		if (cluster.isWorker)
			this._trigger(<Message>{
				event: Event.Load,
				id: id,
				filename: filename
			});
		this._watch(id, filename);
	}
	private static _triggerunload(id:string, filename:string) {
		console.log(`unload ${id.replace(rootpath, ".")}(${filename.replace(rootpath, ".")})`);
		this._trigger(<Message>{
			event: Event.Unload,
			id: id,
			filename: filename
		});
	}
	private static _require(id:string):any {
		if (!id) throw new TypeError("null id");
		let filename = require.resolve(id);
		let m = require.cache[filename];
		if (m) return m.exports;
		this._triggerload(id, filename);
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
	private _db: Promise<Db>; // 打开的mongodb的promise
	private _handlers: any; // 遗留的处理程序入口
	/**
	 * @param uri 链接字符串
	 * @param db 数据库
	 * @param username 用户名
	 * @param password 密码
	 */
	constructor(uri: string, db: string, username?: string, password?: string) {
		if (!uri) throw new Error("need uri");
		if (!db) throw new Error("need db");
		if (username && password) {
			console.log(`connect_mongodb(${uri}, ${username}, ********)`);
		} else {
			console.log(`connect_mongodb(${uri})`);
		}
		let opt:mongodb.MongoClientOptions = {
			promiseLibrary: Promise,
			useNewUrlParser: true
		};
		if (username && password) opt.auth = { user: username, password: password };
		this._db = MongoClient.connect(uri, opt).then(client => client.db(db));
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
		function _session(opt: Daemon.MongoSessionOptions | Daemon.MongoPromiseSessionOptions) {
			return session({
				secret: opt.sessionSecret,
				resave: true,
				saveUninitialized: true,
				store: new MongoStore(opt),
				cookie: { maxAge: opt.ttl * 1000 } // 会话有效期为30天
			});
		}
		let opt: Daemon.SessionOptions = {
			ttl: 30 * 24 * 60 * 60,
			touchAfter: 3600, // 每小时自动更新会话一次
			sessionSecret: "session secret",
			stringify: false
		};
		if (options && options.db) {
			let opt: Daemon.MongoSessionOptions = {
				ttl: 30 * 24 * 60 * 60,
				touchAfter: 3600, // 每小时自动更新会话一次
				sessionSecret: "session secret",
				stringify: false,
				db: null
			};
			Object.assign(opt, options);
			return _session(opt);
		} else {
			let opt: Daemon.MongoPromiseSessionOptions = {
				ttl: 30 * 24 * 60 * 60,
				touchAfter: 3600, // 每小时自动更新会话一次
				sessionSecret: "session secret",
				stringify: false,
				dbPromise: this._db
			};
			Object.assign(opt, options);
			return _session(opt);
		}
	}
	// region mongodb
	mongodb() { // 向req中注入一些方便方法，并替换res的json方法，支持DBRef展开
		// 替换express的json响应
		let daemon = this,
			_json = express.response.json;
		express.response.json = function json(status:number, body?:any, options?:{ indent:number, fields: any, fieldsDefault: any }) {
			let replacer = (indent: number, path: Array<string>, value: any) => { // 实际展开值的函数
				//console.log(`replacer ${indent} ${path.join('.')}`);
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
					//console.log(`replacer ${con.name}`);
					return replace(indent - 1, path, value);
				}
			};
			let replace = (indent: number, path: Array<string>, obj: any) => { // 决定哪些值应予展开的函数
				//console.log(`replace ${indent} ${path.join('.')}`);
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
							//console.log(`replace resolve ${keys}`);
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
							//console.log(`replace resolve ${keys}`);
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
			options = extend(options, resp.$json$options);
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
				return daemon.collection(col)
					.then((collection) => collection.find($query || {}, $fields || {}))
					.then(cursor => cursor.skip($find.$skip).limit($find.$limit).sort($find.$sort));
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
				return daemon.collection(col).then(collection => {
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
			req.findOneAndDelete = (col, filter, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.findOneAndDelete(filter, options));
			};
			req.findOneAndReplace = (col, filter, replacement, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.findOneAndReplace(filter, replacement, options));
			};
			req.findOneAndUpdate = (col, filter, update, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return daemon.collection(col).then((collection) => collection.findOneAndUpdate(filter, update, options));
			};
			req.bucket = bucketName => {
				if (typeof bucketName !== "string") throw new Error("need bucketName");
				return daemon._db.then(db => new mongodb.GridFSBucket(db, { bucketName: bucketName }));
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
	// endregion
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

Daemon._init();
export = Daemon;
