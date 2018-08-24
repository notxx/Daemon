"use strict";
const fs = require("fs");
const path = require("path");
const domain = require("domain");
const cluster = require("cluster");
const express = require("express");
const session = require("express-session");
const cm = require("connect-mongo");
let MongoStore = cm(session);
Promise.prototype.spread = function spread(onfulfilled, onrejected) {
    return this.then((result) => {
        if (Array.isArray(result)) {
            return onfulfilled.apply(this, result);
        }
        else {
            return onfulfilled.call(this, result);
        }
    }, onrejected);
};
const mongodb = require("mongodb");
var MongoClient = mongodb.MongoClient;
const moment = require("moment");
var Event;
(function (Event) {
    Event[Event["Load"] = 0] = "Load";
    Event[Event["Unload"] = 1] = "Unload";
})(Event || (Event = {}));
const rootpath = module.parent
    ? path.dirname(module.parent.filename)
    : __dirname;
class Daemon {
    static _init() {
        if (cluster.isMaster)
            cluster.on("online", worker => {
                worker.on("message", message => this._broadcast_message(worker, message));
            });
        else if (cluster.isWorker)
            cluster.worker.on("message", message => this._onmessage(message));
    }
    static _broadcast_message(source, message) {
        for (let id in cluster.workers) {
            let worker = cluster.workers[id];
            if (worker === source)
                continue;
            worker.send(message);
        }
    }
    static _onmessage(message) {
        if (!message.daemon)
            return;
        switch (message.event) {
            case Event.Load:
                require(message.id);
                this._watch(message.id, message.filename);
                break;
            case Event.Unload:
                this._unload(message);
                break;
        }
    }
    static _watch(id, filename) {
        let watcher = fs.watch(filename, { persistent: false });
        watcher.once("change", () => {
            watcher.close();
            this._triggerunload(id, filename);
        });
    }
    static _unload(message) {
        let m = require.cache[message.filename];
        if (m) {
            if (m.parent) {
                m.parent.children.splice(m.parent.children.indexOf(m), 1);
            }
            delete require.cache[message.filename];
        }
    }
    static _trigger(message) {
        message.daemon = true;
        if (cluster.isWorker) {
            process.send(message);
        }
    }
    static _triggerload(id, filename) {
        console.log(`load ${id.replace(rootpath, ".")}(${filename.replace(rootpath, ".")})`);
        if (cluster.isWorker)
            this._trigger({
                event: Event.Load,
                id: id,
                filename: filename
            });
        this._watch(id, filename);
    }
    static _triggerunload(id, filename) {
        console.log(`unload ${id.replace(rootpath, ".")}(${filename.replace(rootpath, ".")})`);
        this._trigger({
            event: Event.Unload,
            id: id,
            filename: filename
        });
    }
    static _require(id) {
        if (!id)
            throw new TypeError("null id");
        let filename = require.resolve(id);
        let m = require.cache[filename];
        if (m)
            return m.exports;
        this._triggerload(id, filename);
        return require(id);
    }
    static require(id) {
        if (!id)
            throw new TypeError("null id");
        if (id.startsWith(".")) {
            id = path.join(rootpath, id);
            if (!id.startsWith(rootpath))
                throw new TypeError("module out of jail");
        }
        return this._require(id);
    }
    constructor(uri, db, username, password) {
        if (!uri)
            throw new Error("need uri");
        if (!db)
            throw new Error("need db");
        if (username && password) {
            console.log(`connect_mongodb(${uri}, ${username}, ********)`);
        }
        else {
            console.log(`connect_mongodb(${uri})`);
        }
        let opt = {
            promiseLibrary: Promise,
            useNewUrlParser: true
        };
        if (username && password)
            opt.auth = { user: username, password: password };
        this._db = MongoClient.connect(uri, opt).then(client => client.db(db));
        this._handlers = {};
    }
    handlers(handlers) {
        this._handlers = Object.assign({}, handlers);
    }
    CGI(basepath, conf) {
        let domainCache = {};
        this.conf = conf;
        function _exec(func, req, res, next) {
        }
        if (!/^\//.test(basepath)) {
            basepath = path.join(rootpath, basepath);
            if (basepath.indexOf(rootpath) != 0)
                throw new TypeError("basepath out of jail");
        }
        return ((req, res, next) => {
            let absolute = path.join(basepath, req.path);
            if (absolute.indexOf(basepath) != 0)
                return res.status(500).send({ error: "web-module out of jail" });
            try {
                require.resolve(absolute);
            }
            catch (e) {
                let handler = this._handlers[req.path];
                if (handler)
                    return handler(req, res);
                else
                    return res.status(404).send({ error: "module not found" });
            }
            let key = req.path, d;
            if (!domainCache[key]) {
                d = domainCache[key] = domain.create();
                d.on("error", (e) => {
                    res.status(500).send({ error: e.message });
                });
            }
            else {
                d = domainCache[key];
            }
            d.add(req);
            d.add(res);
            d.run(() => {
                const local = Daemon._require(absolute);
                if (!local) {
                    res.status(404).send({ error: "module not found?" });
                }
                else if (typeof (local) === "function") {
                    local.call(conf[key] || this, req, res, next);
                }
                else if (typeof (local.handler) === "function") {
                    local.conf = conf[key];
                    local.global = conf;
                    local.daemon = this;
                    local.exec(req, res, next);
                }
            });
        });
    }
    hot(id) {
    }
    async collection(col) {
        if (typeof col !== "string")
            throw new Error("need collectionName");
        return (await this._db).collection(col);
    }
    session(options) {
        function _session(opt) {
            return session({
                secret: opt.sessionSecret,
                resave: true,
                saveUninitialized: true,
                store: new MongoStore(opt),
                cookie: { maxAge: opt.ttl * 1000 }
            });
        }
        let opt = {
            ttl: 30 * 24 * 60 * 60,
            touchAfter: 3600,
            sessionSecret: "session secret",
            stringify: false
        };
        if (options && options.db) {
            let opt = {
                ttl: 30 * 24 * 60 * 60,
                touchAfter: 3600,
                sessionSecret: "session secret",
                stringify: false,
                db: null
            };
            Object.assign(opt, options);
            return _session(opt);
        }
        else {
            let opt = {
                ttl: 30 * 24 * 60 * 60,
                touchAfter: 3600,
                sessionSecret: "session secret",
                stringify: false,
                dbPromise: this._db
            };
            Object.assign(opt, options);
            return _session(opt);
        }
    }
    mongodb() {
        let daemon = this, _json = express.response.json;
        express.response.json = async function json(status, body, options) {
            const promiseJSON = async (indent, path, value) => {
                if (typeof value !== "object" || !value || indent < 0) {
                    return value;
                }
                if (Array.isArray(value)) {
                    let promises = [];
                    value.forEach(v => {
                        let sub_path = path.slice();
                        sub_path.push('$');
                        promises.push(promiseJSON(indent - 1, sub_path, v));
                    });
                    return Promise.all(promises);
                }
                else if (typeof value === "string") {
                    return value;
                }
                else if (value instanceof Promise ||
                    (typeof (value.then) === "function")) {
                    const t = {};
                    return Promise.race([value, t])
                        .then(v => (v === t) ? "pending" : "resolved", () => "rejected")
                        .then(s => ({ $promise: s }));
                }
                else if (value instanceof Date) {
                    return { $date: value.getTime() };
                }
                else if (typeof (value.toHexString) === "function") {
                    return { $id: value.toHexString() };
                }
                else if (value.namespace && value.oid) {
                    let fields = options.fields[value.namespace];
                    if (fields === false) {
                        return value;
                    }
                    const col = await daemon.collection(value.namespace);
                    return col.findOne({ _id: value.oid }, { fields: fields || options.fieldsDefault });
                }
                else if (value._bsontype === "Decimal128" && typeof (value.toJSON) === "function") {
                    return value.toJSON();
                }
                else {
                    return replace(indent - 1, path, value);
                }
            };
            const replace = async (indent, path, obj) => {
                if (typeof obj !== "object" || !obj || indent <= 0) {
                    return obj;
                }
                if (!path)
                    path = [];
                const promises = [];
                if (Array.isArray(obj)) {
                    const indexes = [], resulta = [];
                    obj.forEach((v, i) => {
                        indexes.push(i);
                        let sub_path = path.slice();
                        sub_path.push('$');
                        promises.push(promiseJSON(indent - 1, sub_path, v));
                    });
                    let values = await Promise.all(promises);
                    indexes.forEach((index, i) => {
                        resulta[index] = values[i];
                    });
                    return resulta;
                }
                else {
                    let keys = Array(), resulto = {};
                    for (let key in obj) {
                        if (!obj.hasOwnProperty(key)) {
                            continue;
                        }
                        keys.push(key);
                        let sub_path = path.slice();
                        sub_path.push(key);
                        promises.push(promiseJSON(indent - 1, sub_path, obj[key]));
                    }
                    let values = await Promise.all(promises);
                    keys.forEach((key, i) => {
                        resulto[key] = values[i];
                    });
                    return resulto;
                }
            };
            let resp = this;
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
                _json.apply(resp, [(await replace(options.indent, [], body))]);
            }
            else {
                _json.apply(resp, [body]);
            }
        };
        return ((req, res, next) => {
            req.col = daemon.collection.bind(this);
            req.find = async (col, query, fields, sort, skip, limit) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                let $find = req.$find = {}, $query = $find.$query = query, $fields = $find.$fields = fields || req.query.$fields || req.body.$fields, $skip = $find.$skip = skip || req.query.$skip || req.body.$skip || 0, $limit = $find.$limit = limit || req.query.$limit || req.body.$limit || 20, $sort = $find.$sort = sort || req.query.$sort || req.body.$sort;
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
            req._find = res.find = async (cursor) => {
                if (typeof (cursor.toArray) === "function" && typeof (cursor.count) === "function"
                    && req.$find) {
                    let $find = Object.assign({}, req.$find);
                    $find.$array = await cursor.toArray();
                    $find.$count = await cursor.count(false);
                    res.json($find);
                }
                else if (typeof (cursor.toArray) === "function") {
                    res.json(await cursor.toArray());
                }
                else {
                    res.json(cursor);
                }
            };
            req.findOne = async (col, query, fields) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                let $fields = req.query.$fields || req.body.$fields;
                return (await daemon.collection(col)).findOne(query || {}, { fields: fields || $fields || {} });
            };
            req._array = req._findOne = res.array = res.findOne = (r) => {
                res.json(r);
            };
            req.insert = async (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).insert(op, options);
            };
            req._insert = res.insert = r => {
                if (r.result)
                    res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                else
                    res.json(r);
            };
            req.insertMany = async (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).insertMany(op, options);
            };
            res.insertMany = r => {
                if (r.result && r.ops)
                    res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                else
                    res.json(r);
            };
            req.save = async (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).save(op, options);
            };
            req.update = async (col, query, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).update(query, op, options);
            };
            req.remove = async (col, query, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
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
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).findOneAndDelete(filter, options);
            };
            req.findOneAndReplace = async (col, filter, replacement, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).findOneAndReplace(filter, replacement, options);
            };
            req.findOneAndUpdate = async (col, filter, update, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return (await daemon.collection(col)).findOneAndUpdate(filter, update, options);
            };
            req.bucket = async (bucketName) => {
                if (typeof bucketName !== "string")
                    throw new Error("need bucketName");
                return new mongodb.GridFSBucket((await daemon._db), { bucketName: bucketName });
            };
            req._ex = res.ex = (ex) => {
                res.status(500).json(ex.message ? { message: ex.message, stack: ex.stack } : { ex: ex });
            };
            req._export = (data, names) => {
                names.forEach((name) => {
                    data[name] = req.query[name] || req.body[name];
                });
            };
            req._exportInt = (data, names) => {
                names.forEach((name) => {
                    data[name] = parseInt(req.query[name] || req.body[name]);
                });
            };
            req.id = prop => {
                prop = prop || "_id";
                let id = (req.query[prop] || req.body[prop]);
                if (!id)
                    return id;
                return (typeof (id.$id) === "string") ?
                    new mongodb.ObjectId(id.$id) : id;
            };
            req.dbRef = async (prop, $ref) => {
                if (!prop)
                    throw new TypeError("prop");
                let id = (req.query[prop] || req.body[prop]);
                if (!id)
                    return Promise.reject();
                if (typeof (id.$ref) === "string") {
                    return new mongodb.DBRef(id.$ref, (typeof (id.$id) === "string") ? new mongodb.ObjectId(id.$id) : id);
                }
                else if (typeof ($ref) === "string") {
                    return new mongodb.DBRef($ref, (typeof (id.$id) === "string") ? new mongodb.ObjectId(id.$id) : id);
                }
                else
                    throw new TypeError("need $ref");
            };
            next();
        });
    }
    _moment(exp) {
        let exp0, m;
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
    constructor(handler) {
        if (typeof (handler) !== "function")
            throw new TypeError("handler");
        this.handler = handler;
    }
    exec(req, res, next) {
        if (typeof (this.handler) !== "function")
            throw new TypeError("handler");
        this.handler(req, res, next);
    }
};
Daemon._init();
module.exports = Daemon;
