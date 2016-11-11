"use strict";
const fs = require("fs");
const path = require("path");
const domain = require("domain");
const util = require('util');
var extend = util._extend;
// express
const express = require("express");
const session = require("express-session");
const cm = require('connect-mongo');
var MongoStore = cm(session);
// mongodb & promise
const es6_promise_1 = require("es6-promise");
const mongodb = require("mongodb");
var MongoClient = mongodb.MongoClient;
var ObjectID = mongodb.ObjectID;
var DBRef = mongodb.DBRef;
// moment
const moment = require("moment");
class Daemon {
    constructor(connection_string, username, password) {
        this.realm = "Authentication Zone";
        if (username && password) {
            console.log("connect_mongodb(" + [connection_string, username, "********"].join(", ") + ")");
        }
        else {
            console.log("connect_mongodb(" + connection_string + ")");
        }
        var self = this;
        self._db = new es6_promise_1.Promise(function (resolve, reject) {
            MongoClient.connect(connection_string, {
                promiseLibrary: es6_promise_1.Promise,
                native_parser: !!mongodb.BSONNative,
                safe: true
            }).then(function (db) {
                if (username && password) {
                    db.authenticate(username, password)
                        .then(function (result) {
                        console.log("mc.authenticate() => ", result);
                        if (result)
                            resolve(db);
                        else
                            reject("username/password");
                    }, function (err) {
                        console.log("mc.authenticate() error:", err.errmsg);
                        reject(err);
                    });
                }
                else {
                    console.log("mc.connected()");
                    resolve(db);
                }
            }).done();
        });
        self._handlers = {};
    }
    handlers(handlers) {
        this._handlers = extend({}, handlers);
    }
    CGI(basepath, conf) {
        var self = this, domainCache = {}; // 执行域缓存
        self.conf = conf;
        function _exec(func, req, res, next) {
            var key = req.path, d;
            if (!domainCache[key]) {
                d = domainCache[key] = domain.create();
                d.on("error", function (e) {
                    res.status(500).send({ error: e.message });
                });
            }
            else {
                d = domainCache[key];
            }
            d.run(function () {
                if (conf[key]) {
                    func.call(conf[key], req, res, next);
                }
                else {
                    func(req, res, next);
                }
            });
        }
        if (!/^\//.test(basepath)) {
            basepath = path.join(path.dirname(module.parent.filename), basepath); // 使用父模块的相对路径
        }
        return function _CGI(req, res, next) {
            var absolute = path.join(basepath, req.path);
            if (absolute.indexOf(basepath) != 0)
                return res.status(500).send({ error: "out of jail" });
            try {
                var filename = require.resolve(absolute);
            }
            catch (e) {
                var handler = self._handlers[req.path];
                if (handler)
                    return handler(req, res);
                else
                    return res.status(404).send({ error: "module not found" });
            }
            var module = require.cache[filename];
            if (module) {
                return _exec(module.exports, req, res, next);
            }
            var watcher = fs.watch(filename, { persistent: false });
            watcher.on("change", function () {
                console.log("unload " + filename);
                watcher.close();
                if (module && module.parent) {
                    module.parent.children.splice(module.parent.children.indexOf(module), 1);
                }
                delete require.cache[filename];
            });
            _exec(require(absolute), req, res, next);
            console.log("load " + filename);
        };
    }
    collection(col) {
        if (typeof col !== "string")
            throw new Error("need collectionName");
        return this._db.then(function (db) { return db.collection(col); });
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
        var opt = {
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
        var stub = null;
        this._db.then(function (db) {
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
        var self = this;
        // 替换express的json响应
        var _json = express.response.json;
        express.response.json = function _mongodb_json(status, body, options) {
            var resp = this, args = Array.prototype.slice.apply(arguments);
            if (typeof status === 'object') {
                options = body;
                body = status;
                status = null;
            }
            function replacer(indent, path, value) {
                //console.log("replacer", indent, path.join('.'));
                if (typeof value !== "object" || !value || indent < 0) {
                    return value;
                }
                var con = value.constructor;
                //console.log("replacer", indent, con.name);
                var callee = arguments.callee, caller = callee.caller;
                if (Array.isArray(value)) {
                    var promises = Array();
                    value.forEach(function (v, i) {
                        var sub_path = path.slice();
                        sub_path.push('$');
                        promises.push(callee(indent - 1, sub_path, v));
                    });
                    //console.log(promises);
                    return es6_promise_1.Promise.all(promises);
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
                    var fields = options.fields[value.namespace];
                    if (fields === false) {
                        return value;
                    }
                    return self.collection(value.namespace)
                        .then(function (col) {
                        return col.findOne({ _id: value.oid }, fields || options.fieldsDefault);
                    });
                }
                else {
                    //console.log("replacer", con.name);
                    //if (caller === replace) { return value; }
                    return replace(indent - 1, path, value);
                }
            }
            ;
            function replace(indent, path, obj) {
                //console.log("replace", indent, path.join('.'));
                if (typeof obj !== "object" || !obj || indent <= 0) {
                    return es6_promise_1.Promise.resolve(obj);
                }
                if (!path)
                    path = [];
                var promises = Array(), promise;
                if (Array.isArray(obj)) {
                    var indexes = Array(), resulta = Array();
                    obj.forEach(function (v, i) {
                        indexes.push(i);
                        var sub_path = path.slice();
                        sub_path.push('$');
                        promises.push(replacer(indent - 1, sub_path, v));
                    });
                    promise = new es6_promise_1.Promise(function (resolve, reject) {
                        es6_promise_1.Promise.all(promises).then(function (values) {
                            //console.log("replace resolve", keys);
                            indexes.forEach(function (index, i) {
                                resulta[index] = values[i];
                            });
                            resolve(resulta);
                        }, reject);
                    });
                }
                else {
                    var keys = Array(), resulto = {};
                    for (var key in obj) {
                        if (!obj.hasOwnProperty(key)) {
                            continue;
                        }
                        keys.push(key);
                        var sub_path = path.slice();
                        sub_path.push(key);
                        promises.push(replacer(indent - 1, sub_path, obj[key]));
                    }
                    promise = new es6_promise_1.Promise(function (resolve, reject) {
                        es6_promise_1.Promise.all(promises).then(function (values) {
                            //console.log("replace resolve", keys);
                            keys.forEach(function (key, i) {
                                resulto[key] = values[i];
                            });
                            resolve(resulto);
                        }, reject);
                    });
                }
                return promise;
            }
            options = extend({
                indent: 5,
                fields: {},
                fieldsDefault: { name: 1 }
            }, resp.$json$options, options);
            if (typeof body === 'object') {
                replace(options.indent, [], body).then(function (value) {
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
        return function (req, res, next) {
            // 自动注入某些通用参数（排序、分页等）
            req.col = self.collection.bind(self);
            req.find = function find(col, query, fields, sort, skip, limit) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                var $find = req.$find = {}, $query = $find.$query = query, $sort = $find.$sort = sort || req.query.$sort || req.body.$sort, $skip = $find.$skip = skip || req.query.$skip || req.body.$skip || 0, $limit = $find.$limit = limit || req.query.$limit || req.body.$limit || 20, $fields = $find.$fields = fields || req.query.$fields || req.body.$fields;
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
                return self.collection(col).then(function (collection) {
                    var cursor = collection.find($query || {}, $fields || {});
                    cursor.sort($find.$sort);
                    cursor.skip($find.$skip);
                    cursor.limit($find.$limit);
                    return cursor;
                });
            };
            req._find = res.find = function response_find(cursor) {
                if (req.$find) {
                    var $find = req.$find;
                    return es6_promise_1.Promise.all([
                        cursor.toArray(),
                        cursor.count(),
                        $find.$sort,
                        $find.$skip,
                        $find.$limit,
                        $find.$fields
                    ]).spread(function (array, count, sort, skip, limit, fields) {
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
                    cursor.toArray().then(function (array) {
                        res.json(array);
                    });
                }
                else {
                    res.json(cursor);
                }
            };
            req.findOne = function findOne(col, query, fields) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                var $fields = req.query.$fields || req.body.$fields;
                return self.collection(col).then(function (collection) {
                    return collection.findOne(query || {}, fields || $fields || {});
                });
            };
            req._array = req._findOne = res.array = res.findOne = function response_one(r) {
                res.json(r);
            };
            req.insert = function insert(col, op, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.insert(op, options);
                });
            };
            req._insert = res.insert = function response_insert(r) {
                if (r.result)
                    res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                else
                    res.json(r);
            };
            req.insertMany = function insertMany(col, op, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.insertMany(op, options);
                });
            };
            res.insertMany = function response_insertMany(r) {
                //if (r.result)
                //	res.json({ insert: r.ops, ok: r.result.ok, n: r.result.n });
                //else
                res.json(r);
            };
            req.save = function save(col, op, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.save(op, options);
                });
            };
            req.update = function update(col, query, op, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.update(query, op, options);
                });
            };
            req.remove = function remove(col, query, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.remove(query, options);
                });
            };
            req._remove = req._save = req._update = res.update = function response_update(...r) {
                var result;
                if (r.length > 1) {
                    result = { ok: 1, nModified: 0, n: 0 };
                    r.forEach(function (r) {
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
            req.findAndModify = function findAndModify(col, query, sort, op, options) {
                if (typeof col !== "string")
                    throw new Error("need collectionName");
                return self.collection(col).then(function (collection) {
                    return collection.findAndModify(query, sort, op, options);
                });
            };
            // 匹配输出的方便方法
            req._ex = res.ex = function response_ex(ex) {
                res.status(500).json(ex.message ? { message: ex.message, stack: ex.stack } : { ex: ex });
            };
            // 将参数复制到对象
            req._export = function request_export(data, names) {
                names.forEach(function (name) {
                    data[name] = req.query[name] || req.body[name];
                });
            };
            req._exportInt = function request_export_int(data, names) {
                names.forEach(function (name) {
                    data[name] = parseInt(req.query[name] || req.body[name]);
                });
            };
            next();
        };
    }
    _moment(exp) {
        var exp0, m;
        if (typeof exp === 'string' && /^\d+$/.test(exp))
            exp0 = parseInt(exp);
        else if (typeof exp === 'number')
            exp0 = exp;
        else
            return null;
        m = moment(exp);
        return m.isValid() ? m : null;
    }
    whitelist_add(ip) {
        this.whitelist.push(ip);
    }
    basic_add(username, password) {
        this.basic.push("Basic " + new Buffer(username + ":" + password).toString("base64"));
    }
    hybrid_auth(realm) {
        var self = this;
        if (realm) {
            self.realm = realm;
        }
        return function _hybrid_auth(req, res, next) {
            function _reject() {
                res.set("WWW-Authenticate", "Basic realm=\"" + self.realm + "\"");
                res.sendStatus(401);
            }
            var ip = req.headers["x-real-ip"], auth = req.headers["authorization"];
            if (self.whitelist.indexOf(ip) >= 0 // IP 白名单
                || self.basic.indexOf(auth) >= 0) {
                next();
            }
            else if (self._db) {
                var __db;
                self._db.then(function (db) {
                    __db = db;
                    return __db.collection("hybrid_ip_whitelist");
                }).then(function (col) {
                    return col.findOne({ ip: ip });
                }).then(function (record) {
                    if (record) {
                        next(); // 短路
                        return es6_promise_1.Promise.reject(record);
                    }
                    return __db.collection("hybrid_authorization");
                }).then(function (col) {
                    return col.findOne({ auth: auth });
                }).then(function (record) {
                    if (record) {
                        next(); // 短路
                        return es6_promise_1.Promise.reject(record);
                    }
                    _reject();
                });
            }
            else {
                _reject();
            }
        };
    }
}
module.exports = Daemon;
//# sourceMappingURL=Daemon.js.map