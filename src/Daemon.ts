// node
import * as fs from "fs"
import * as path from "path"
import * as domain from "domain"
import * as cluster from "cluster"
// express
import * as express from "express"

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

// mongodb
import * as mongodb from "mongodb"

// moment
import * as moment from "moment"

declare module Daemon {
	interface SessionOptions {
		ttl: number,
		touchAfter: number,
		stringify: boolean,
		sessionSecret: string; // 会话密钥
		db?: mongodb.Db;
		dbPromise?: Promise<mongodb.Db>;
	}
	interface MongoSessionOptions extends SessionOptions {
		db: mongodb.Db;
	}
	interface MongoPromiseSessionOptions extends SessionOptions {
		dbPromise: Promise<mongodb.Db>;
	}

	interface Request extends express.Request {
		/**
		 * 获取数据表
		 * 
		 * @param collectionName 表名
		 */
		col:(collectionName:string) => Promise<mongodb.Collection>;
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
		updateMany:(col:string, query: mongodb.FilterQuery<any>, op: (mongodb.UpdateQuery<any>), options?: mongodb.UpdateManyOptions) => Promise<mongodb.UpdateWriteOpResult>;
		updateOne:(col:string, query: mongodb.FilterQuery<any>, op: (mongodb.UpdateQuery<any>), options?: mongodb.UpdateOneOptions) => Promise<mongodb.UpdateWriteOpResult>;
		_update:(r:mongodb.WriteOpResult) => void;
		remove:(col:string, query:any, options?: mongodb.CommonOptions & { single?: boolean; }) => Promise<mongodb.WriteOpResult>;
		_remove:(r:mongodb.WriteOpResult) => void;
		findOneAndDelete:(col:string, filter:Object, options: mongodb.FindOneAndDeleteOption<any>) => Promise<mongodb.FindAndModifyWriteOpResultObject<any>>;
		findOneAndReplace:(col:string, filter:Object, replacement:Object, options?:mongodb.FindOneAndReplaceOption<any>) => Promise<mongodb.FindAndModifyWriteOpResultObject<any>>;
		findOneAndUpdate:(col:string, filter:Object, update:Object, options?:mongodb.FindOneAndReplaceOption<any>) => Promise<mongodb.FindAndModifyWriteOpResultObject<any>>;
		bucket:(bucketName:string) => Promise<mongodb.GridFSBucket>;
		_ex: (ex:Error | {}) => void;
		_export:(data:any, name:string[]) => void;
		_exportInt:(data:any, name:string[]) => void;
		/**
		 * 抽取属性为<code>id</code>
		 * 
		 * @param prop 属性名
		 */
		id:(prop?:string) => mongodb.ObjectId | string;
		/**
		 * 抽取属性为<code>DBRef</code>
		 * 
		 * @param prop 属性名
		 * @param $ref 数据表
		 */
		dbRef:(prop:string, $ref?:string) => Promise<mongodb.DBRef>;
		/** 检索状态 */
		$find:FindState;
	}
	interface Response extends express.Response {
		find:<T>(cursor:mongodb.Cursor) => void;
		findOne:<T>(r:T) => void;
		array:<T>(r:T[]) => void;
		insert:(r:mongodb.InsertOneWriteOpResult<any>) => void;
		insertMany:(r:mongodb.InsertWriteOpResult<any>) => void;
		update:(r:mongodb.WriteOpResult) => void;
		ex: (ex:Error | any) => void;
		$json$options: JsonOptions;
	}
	interface JsonOptions {
		indent?: number;
		fields?: any;
		fieldsDefault?: any;
	}
	interface FindState {
		$query?: any;
		$fields?: any;
		$skip?: number;
		$limit?: number;
		$sort?: any|string;
		$array?: any[];
		$count?: number;
	}
	interface Route {
		(req: Request, res: Response, ...data:any[]): void;
	}
	class Spawn {
		conf: any;
		global: any;
		daemon: Daemon;
		constructor(callback:(req: Daemon.Request, res: Daemon.Response, next: Function) => any);
		exec: (req: Request, res: Response, next: Function) => any;
	}
}
interface Daemon {
	CGI(path: string, conf?: {}): void
	_moment(exp:string|number): moment.Moment
}
interface MongoDaemon extends Daemon {
	collection(col:string): Promise<mongodb.Collection>
	session(options: (Daemon.MongoSessionOptions | Daemon.MongoPromiseSessionOptions)): express.RequestHandler
	mongodb(): express.RequestHandler
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

const rootpath = (module.parent && module.parent.filename)
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
	private _handlers: any; // 遗留的处理程序入口
	constructor() {}
	handlers(handlers:{}) {
		this._handlers = Object.assign({}, handlers);
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
		return ((req:Daemon.Request, res:Daemon.Response, next:Function) => {
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
			d.add(req);
			d.add(res);
			d.run(() => {
				const local = Daemon._require(absolute);
				if (!local) {
					res.status(404).send({ error: "module not found?" });
				} else if (typeof(local) === "function") {
					(<Function>local).call(conf[key] || this, req, res, next);
				} else if (typeof(local.handler) === "function") { // Spawn
					local.conf = conf[key];
					local.global = conf;
					local.daemon = this;
					local.exec(req, res, next);
				}
			});
		});
	}
}
class MongoDaemon {
	private _db: Promise<mongodb.Db>; // 打开的mongodb的promise
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
		const { MongoClient } = require("mongodb")
		let opt:mongodb.MongoClientOptions = {
			promiseLibrary: Promise,
			useNewUrlParser: true
		};
		if (username && password) opt.auth = { user: username, password: password };
		this._db = MongoClient.connect(uri, opt).then((client:mongodb.MongoClient) => client.db(db));
	}
	hot(id:string) {
	}
	async collection(col:string) {
		if (typeof col !== "string") throw new Error("need collectionName");
		return (await this._db).collection(col);
	}
	session(options: Daemon.SessionOptions) {
		const session = require("express-session")
		const cm = require("connect-mongo")
		let MongoStore = cm(session);
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
		const mongodb = require("mongodb")
		const express = require("express")
		// 替换express的json响应
		let daemon = this,
			_json = express.response.json;
		express.response.json = async function json(status:number, body?:any, options?:Daemon.JsonOptions) {
			const promiseJSON = async (indent: number, path: Array<string>, value: any) => { // 实际展开值的函数
				//console.log(`replacer ${indent} ${path.join('.')}`);
				if (typeof value !== "object" || !value || indent < 0) { return value; }
				if (Array.isArray(value)) { // Array
					let promises:Promise<any>[] = [];
					value.forEach(v => {
						let sub_path = path.slice();
						sub_path.push('$');
						promises.push(promiseJSON(indent - 1, sub_path, v));
					});
					//console.log(promises);
					return Promise.all(promises);
				} else if (typeof value === "string") {
					return value;
				} else if (value instanceof Promise || // Promise
						(typeof(value.then) === "function")) { // or PromiseLike
					const t = {};
					return Promise.race([ value, t ])
					.then(v => (v === t) ? "pending" : "resolved", () => "rejected")
					.then(s => ({ $promise: s }));
				} else if (value instanceof Date) {
					return { $date: value.getTime() };
				} else if (typeof(value.toHexString) === "function") { // ObjectId-ish
					return { $id: value.toHexString() };
				} else if (value.namespace && value.oid) { // DBRef-ish
					let fields = options.fields[value.namespace];
					if (fields === false) { return value; }
					const col = await daemon.collection(value.namespace)
					return col.findOne({ _id: value.oid }, { fields: fields || options.fieldsDefault });
                } else if (value._bsontype === "Decimal128" && typeof (value.toJSON) === "function") { // Decimal128
                    return value.toJSON();
				} else {
					//console.log(`replacer ${con.name}`);
					return replace(indent - 1, path, value);
				}
			};
			const replace = async (indent: number, path: Array<string>, obj: any) => { // 决定哪些值应予展开的函数
				//console.log(`replace ${indent} ${path.join('.')}`);
				if (typeof obj !== "object" || !obj || indent <= 0) { return obj; }
				if (!path) path = [];
				const promises:Promise<any>[] = [];
				if (Array.isArray(obj)) {
					const indexes:number[] = [],
						resulta:any[] = [];
					obj.forEach((v, i) => {
						indexes.push(i);
						let sub_path = path.slice();
						sub_path.push('$');
						promises.push(promiseJSON(indent - 1, sub_path, v));
					});
					let values = await Promise.all(promises);
					// console.log(`replace resolve ${indexes}`);
					indexes.forEach((index, i) => {
						resulta[index] = values[i];
					});
					return resulta;
				} else {
					let keys = Array<string>(),
						resulto:any = {};
					for (let key in obj) {
						if (!obj.hasOwnProperty(key)) { continue; }
						keys.push(key);
						let sub_path = path.slice();
						sub_path.push(key);
						promises.push(promiseJSON(indent - 1, sub_path, obj[key]));
					}
					let values = await Promise.all(promises);
					//console.log(`replace resolve ${keys}`);
					keys.forEach((key, i) => {
						resulto[key] = values[i];
					});
					return resulto;
				}
			}

			let resp: Daemon.Response = this;
			if (typeof status === 'object') {
				options = body;
				body = status;
				status = null;
			}
			options = Object.assign({
				indent: 5,
				fields: {},
				fieldsDefault: { name: 1 }
			}, options, resp.$json$options);
			if (status)
				resp.status(status);
			if (typeof body === 'object') {
				_json.apply(resp, [ (await replace(options.indent, [], body)) ]);
			} else {
				_json.apply(resp, [ body ]);
			}
		}
		return ((req:Daemon.Request, res:Daemon.Response, next:Function) => {
			// 自动注入某些通用参数（排序、分页等）
			req.col = daemon.collection.bind(this);
			req.find = async (col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				let $find:Daemon.FindState = req.$find = {},
					$query = $find.$query = query,
					$fields = $find.$fields = fields || req.query.$fields || req.body.$fields,
					$skip = $find.$skip = skip || req.query.$skip || req.body.$skip || 0,
					$limit = $find.$limit = limit || req.query.$limit || req.body.$limit || 20,
					$sort = $find.$sort = sort || req.query.$sort || req.body.$sort;
				if (typeof $skip === 'string')
					$skip = $find.$skip = parseInt($skip);
				if (typeof $limit === 'string')
					$limit = $find.$limit = parseInt($limit);
				switch (typeof $sort) {
				case "object":
					break;
				case "string":
					$find.$sort = {};
					$find.$sort[$sort] = 1;
					$sort = $find.$sort;
					break;
				default:
					$sort = { _id: 1 };
				}
				return (await daemon.collection(col))
					.find($query || {}).project($fields || {})
					.skip($skip).limit($limit).sort($sort);
			};
			req._find = res.find = async (cursor: mongodb.Cursor) => {
				if (typeof(cursor.toArray) === "function" && typeof(cursor.count) === "function" // check cursor
						&& req.$find) { // and $find criteria
					let $find = Object.assign({}, req.$find);
					$find.$array = await cursor.toArray();
					$find.$count = await cursor.count(false);
					res.json($find);
				} else if (typeof(cursor.toArray) === "function") { // fallback to toArray()
					res.json(await cursor.toArray());
				} else {
					res.json(cursor);
				}
			};
			req.findOne = async (col:string, query:{}, fields?:{}) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				let $fields = req.query.$fields || req.body.$fields;
				return (await daemon.collection(col)).findOne(query || {}, { fields: fields || $fields || {} });
			};
			req._array = req._findOne = res.array = res.findOne = (r:any) => {
				res.json(r);
			};
			req.insert = async (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).insert(op, options);
			};
			req._insert = res.insert = r => {
				if (r.result)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.insertMany = async (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).insertMany(op, options);
			};
			res.insertMany = r => {
				if (r.result && r.ops)
					res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
				else
					res.json(r);
			};
			req.save = async (col, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).save(op, options);
			};
			req.update = async (col, query, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).update(query, op, options);
			};
			req.updateMany = async (col, query, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).updateMany(query, op, options);
			};
			req.updateOne = async (col, query, op, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).updateOne(query, op, options);
			};
			req.remove = async (col, query, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).remove(query, options);
			};
			req._remove = req._save = req._update = res.update = r => {
				let result = r.result;
				if (result)
					res.json({ ok: result.ok, nModified: result.nModified, n: result.n });
				else
					res.json(r);
			};
			req.findOneAndDelete = async (col, filter, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).findOneAndDelete(filter, options);
			};
			req.findOneAndReplace = async (col, filter, replacement, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).findOneAndReplace(filter, replacement, options);
			};
			req.findOneAndUpdate = async (col, filter, update, options) => {
				if (typeof col !== "string") throw new Error("need collectionName");
				return (await daemon.collection(col)).findOneAndUpdate(filter, update, options);
			};
			req.bucket = async bucketName => {
				if (typeof bucketName !== "string") throw new Error("need bucketName");
				return new mongodb.GridFSBucket((await daemon._db), { bucketName: bucketName });
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
			req.id = prop => {
				prop = prop || "_id";
				let id = (req.query[prop] || req.body[prop]);
				if (!id) return id;
				return (typeof(id.$id) === "string") ?
					new mongodb.ObjectId(id.$id) : id;
			};
			req.dbRef = async (prop, $ref) => {
				if (!prop) throw new TypeError("prop");
				let id = (req.query[prop] || req.body[prop]);
				if (!id) return Promise.reject("null");
				let hasOid = (typeof(id.$id) === "string"); // has oid
				if (hasOid && !/^[a-f\d]{24}$/i.test(id.$id)) return Promise.reject("!ObjectId");
				if (typeof($ref) === "string") {
					return new mongodb.DBRef($ref, 
						hasOid ? new mongodb.ObjectId(id.$id) : id);
				} else if (typeof(id.$ref) === "string") {
					return new mongodb.DBRef(id.$ref, 
						hasOid ? new mongodb.ObjectId(id.$id) : id);
				} else throw new TypeError("need $ref");
			};
			next();
		});
	}
	// endregion
	_moment(exp:string|number): moment.Moment { // 将输入的参数转化为moment类型的值
		const moment = require("moment")
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
Daemon.Spawn = class Spawn {
	conf: any;
	global: any;
	daemon: Daemon;
	constructor(handler:(req: Daemon.Request, res: Daemon.Response, next: Function) => any) {
		if (typeof(handler) !== "function") throw new TypeError("handler");
		this.handler = handler;
	}
	private handler: (req: Daemon.Request, res: Daemon.Response, next: Function) => void;
	exec(req: Daemon.Request, res: Daemon.Response, next: Function): void {
		if (typeof(this.handler) !== "function") throw new TypeError("handler");
		this.handler(req, res, next);
	}
}
Daemon._init();
export = { Daemon, MongoDaemon };
