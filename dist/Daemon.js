"use strict";
const fs = require("fs");
const path = require("path");
const domain = require("domain");
const util = require('util');
let extend = util._extend;
// express
const express = require("express");
const session = require("express-session");
const cm = require('connect-mongo');
let MongoStore = cm(session);
// mongodb & promise
require("es6-promise/auto");
Promise.prototype.spread = function spread(onfulfilled, onrejected) {
    return this.then((result) => {
        if (Array.isArray(result)) {
            onfulfilled.apply(this, result);
        }
        else {
            onfulfilled.call(this, result);
        }
    }, onrejected);
};
// Promise.prototype.then;
const mongodb = require("mongodb");
var MongoClient = mongodb.MongoClient;
var ObjectID = mongodb.ObjectID;
var DBRef = mongodb.DBRef;
// moment
const moment = require("moment");
const rootpath = path.dirname(module.parent.filename); // 使用父模块的相对路径
class Daemon {
    constructor(connection_string, username, password) {
        if (username && password) {
            console.log("connect_mongodb(" + [connection_string, username, "********"].join(", ") + ")");
        }
        else {
            console.log("connect_mongodb(" + connection_string + ")");
        }
        this._db = new Promise((resolve, reject) => {
            MongoClient.connect(connection_string, {
                promiseLibrary: Promise,
                native_parser: !!mongodb.BSONNative,
                safe: true
            }).then((db) => {
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
                }
                else {
                    console.log("mc.connected()");
                    resolve(db);
                }
            });
        });
        this._handlers = {};
    }
    static _require(id) {
        if (!id)
            throw new TypeError("null id");
        let filename = require.resolve(id);
        let module = require.cache[filename];
        if (module)
            return module.exports;
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
    handlers(handlers) {
        this._handlers = extend({}, handlers);
    }
    CGI(basepath, conf) {
        let domainCache = {}; // 执行域缓存
        this.conf = conf;
        function _exec(func, req, res, next) {
        }
        if (!/^\//.test(basepath)) {
            basepath = path.join(rootpath, basepath); // 使用父模块的相对路径
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
            d.run(() => Daemon._require(absolute).call(conf[key] || this, req, res, next));
        });
    }
    hot(id) {
    }
    collection(col) {
        if (typeof col !== "string")
            throw new Error("need collectionName");
        return this._db.then((db) => db.collection(col));
    }
    session(options) {
        function _session(opt) {
            return session({
                secret: opt.sessionSecret,
                resave: true,
                saveUninitialized: true,
                store: new MongoStore(opt),
                cookie: { maxAge: opt.ttl * 1000 } // 会话有效期为30天
            });
        }
        let opt = {
            db: null,
            ttl: 30 * 24 * 60 * 60,
            touchAfter: 3600,
            sessionSecret: "session secret",
            stringify: false
        };
        extend(opt, options);
        if (opt.db) {
            return _session(opt);
        }
        let stub = null;
        this._db.then((db) => {
            opt.db = db;
            stub = _session(opt);
        });
        return (function (req, res, next) {
            if (stub) {
                stub.apply(this, [].slice.apply(arguments));
            }
            else {
                res.status(500).send("session not ready");
            }
        });
    }
    mongodb() {
        // 替换express的json响应
        let daemon = this, _json = express.response.json;
        express.response.json = function json(status, body, options) {
            let replacer = (indent, path, value) => {
                //console.log("replacer", indent, path.join('.'));
                if (typeof value !== "object" || !value || indent < 0) {
                    return value;
                }
                let con = value.constructor;
                if (Array.isArray(value)) {
                    let promises = Array();
                    value.forEach((v, i) => {
                        let sub_path = path.slice();
                        sub_path.push('$');
                        promises.push(replacer(indent - 1, sub_path, v));
                    });
                    //console.log(promises);
                    return Promise.all(promises);
                }
                else if (con === String) {
                    return value;
                }
                else if (con === Date) {
                    return { $date: value.getTime() };
                }
                else if (con === ObjectID) {
                    return { $id: value.toHexString() };
                }
                else if (con === DBRef) {
                    let fields = options.fields[value.namespace];
                    if (fields === false) {
                        return value;
                    }
                    return daemon.collection(value.namespace)
                        .then((col) => {
                        return col.findOne({ _id: value.oid }, fields || options.fieldsDefault);
                    });
                }
                else {
                    //console.log("replacer", con.name);
                    return replace(indent - 1, path, value);
                }
            };
            let replace = (indent, path, obj) => {
                //console.log("replace", indent, path.join('.'));
                if (typeof obj !== "object" || !obj || indent <= 0) {
                    return Promise.resolve(obj);
                }
                if (!path)
                    path = [];
                let promises = Array(), promise;
                if (Array.isArray(obj)) {
                    let indexes = Array(), resulta = Array();
                    obj.forEach((v, i) => {
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
            };
            let resp = this;
            if (typeof status === 'object') {
                options = body;
                body = status;
                status = null;
            }
            options = extend({
                indent: 5,
                fields: {},
                fieldsDefault: { name: 1 }
            }, resp.$json$options, options);
            if (typeof body === 'object') {
                replace(options.indent, [], body).then((value) => {
                    if (status)
                        resp.status(status);
                    _json.apply(resp, [value]);
                });
            }
            else {
                if (status)
                    resp.status(status);
                _json.apply(resp, [body]);
            }
        };
        return ((req, res, next) => {
            // 自动注入某些通用参数（排序、分页等）
            req.col = daemon.collection.bind(this);
            req.find = (col, query, fields, sort, skip, limit) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                let $find = req.$find = {}, $query = $find.$query = query, $sort = $find.$sort = sort || req.query.$sort || req.body.$sort, $skip = $find.$skip = skip || req.query.$skip || req.body.$skip || 0, $limit = $find.$limit = limit || req.query.$limit || req.body.$limit || 20, $fields = $find.$fields = fields || req.query.$fields || req.body.$fields;
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
                return daemon.collection(col).then((collection) => {
                    let cursor = collection.find($query || {}, $fields || {});
                    cursor.sort($find.$sort);
                    cursor.skip($find.$skip);
                    cursor.limit($find.$limit);
                    return cursor;
                });
            };
            req._find = res.find = (cursor) => {
                if (req.$find) {
                    let $find = req.$find;
                    return Promise.all([
                        cursor.toArray(),
                        cursor.count(),
                        $find.$sort,
                        $find.$skip,
                        $find.$limit,
                        $find.$fields
                    ]).spread((array, count, sort, skip, limit, fields) => {
                        res.json({
                            $array: array,
                            $count: count,
                            $sort: sort,
                            $skip: skip,
                            $limit: limit,
                            $fields: fields
                        });
                    });
                }
                else if (cursor instanceof mongodb.Cursor) {
                    cursor.toArray().then((array) => {
                        res.json(array);
                    });
                }
                else {
                    res.json(cursor);
                }
            };
            req.findOne = (col, query, fields) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                let $fields = req.query.$fields || req.body.$fields;
                return daemon.collection(col).then((collection) => {
                    return collection.findOne(query || {}, fields || $fields || {});
                });
            };
            req._array = req._findOne = res.array = res.findOne = (r) => {
                res.json(r);
            };
            req.insert = (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.insert(op, options);
                });
            };
            req._insert = res.insert = (r) => {
                if (r.result)
                    res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                else
                    res.json(r);
            };
            req.insertMany = (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.insertMany(op, options);
                });
            };
            res.insertMany = (r) => {
                //if (r.result)
                //	res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                //else
                res.json(r);
            };
            req.save = (col, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.save(op, options);
                });
            };
            req.update = (col, query, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.update(query, op, options);
                });
            };
            req.remove = (col, query, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.remove(query, options);
                });
            };
            req._remove = req._save = req._update = res.update = (...r) => {
                let result;
                if (r.length > 1) {
                    result = { ok: 1, nModified: 0, n: 0 };
                    r.forEach((r) => {
                        if (!r.result.ok)
                            result.ok = 0;
                        result.nModified += r.result.nModified;
                        result.n += r.result.n;
                    });
                }
                else {
                    result = r[0].result;
                }
                if (result)
                    res.json({ ok: result.ok, nModified: result.nModified, n: result.n });
                else
                    res.json(r);
            };
            req.findAndModify = (col, query, sort, op, options) => {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return daemon.collection(col).then((collection) => {
                    return collection.findAndModify(query, sort, op, options);
                });
            };
            // 匹配输出的方便方法
            req._ex = res.ex = (ex) => {
                res.status(500).json(ex.message ? { message: ex.message, stack: ex.stack } : { ex: ex });
            };
            // 将参数复制到对象
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
module.exports = Daemon;
//# sourceMappingURL=Daemon.js.map