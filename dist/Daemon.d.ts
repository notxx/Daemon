import * as express from "express";
import * as cm from "connect-mongo";
declare global {
    interface Promise<T> {
        spread<TResult1, TResult2>(onfulfilled: (...values: any[]) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2>;
    }
}
import * as mongodb from "mongodb";
import Db = mongodb.Db;
import * as moment from "moment";
declare module Daemon {
    interface SessionOptions extends cm.DefaultOptions {
        sessionSecret: string;
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
        col: (collectionName: string) => Promise<mongodb.Collection>;
        find: (col: string, query?: {}, fields?: {}, sort?: {}, skip?: number, limit?: number) => Promise<mongodb.Cursor>;
        _find: (cursor: mongodb.Cursor) => void;
        findOne: <T>(col: string, query: any, fields?: any) => Promise<T>;
        _findOne: <T>(r: T) => void;
        _array: <T>(r: T[]) => void;
        insert: (col: string, op: any, options?: mongodb.CollectionInsertOneOptions) => Promise<mongodb.WriteOpResult>;
        _insert: (r: mongodb.WriteOpResult) => void;
        insertMany: (col: string, docs: any[], options?: mongodb.CollectionInsertManyOptions) => Promise<mongodb.WriteOpResult>;
        save: (col: string, op: any, options?: mongodb.CommonOptions) => Promise<mongodb.WriteOpResult>;
        _save: (r: mongodb.WriteOpResult) => void;
        update: (col: string, query: any, op: any, options?: mongodb.ReplaceOneOptions & {
            multi?: boolean;
        }) => Promise<mongodb.WriteOpResult>;
        _update: (r: mongodb.WriteOpResult) => void;
        remove: (col: string, query: any, options?: mongodb.CommonOptions & {
            single?: boolean;
        }) => Promise<mongodb.WriteOpResult>;
        _remove: (r: mongodb.WriteOpResult) => void;
        findOneAndDelete: (col: string, filter: Object, options: {
            projection?: Object;
            sort?: Object;
            maxTimeMS?: number;
        }) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
        findOneAndReplace: (col: string, filter: Object, replacement: Object, options?: mongodb.FindOneAndReplaceOption) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
        findOneAndUpdate: (col: string, filter: Object, update: Object, options?: mongodb.FindOneAndReplaceOption) => Promise<mongodb.FindAndModifyWriteOpResultObject>;
        bucket: (bucketName: string) => Promise<mongodb.GridFSBucket>;
        _ex: (ex: Error | {}) => void;
        _export: (data: any, name: string[]) => void;
        _exportInt: (data: any, name: string[]) => void;
        id: (prop?: string) => mongodb.ObjectId | string;
        dbRef: (prop: string, $ref?: string) => Promise<mongodb.DBRef>;
        $find: FindState;
    }
    interface Response extends express.Response {
        find: <T>(cursor: mongodb.Cursor) => void;
        findOne: <T>(r: T) => void;
        array: <T>(r: T[]) => void;
        insert: (r: mongodb.InsertOneWriteOpResult) => void;
        insertMany: (r: mongodb.InsertWriteOpResult) => void;
        update: (r: mongodb.WriteOpResult) => void;
        ex: (ex: Error | any) => void;
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
        $sort?: any | string;
        $array?: any[];
        $count?: number;
    }
    interface Route {
        (req: Request, res: Response, ...data: any[]): void;
    }
    class Spawn {
        conf: any;
        global: any;
        daemon: Daemon;
        constructor(callback: (req: Daemon.Request, res: Daemon.Response, next: Function) => any);
        exec: (req: Request, res: Response, next: Function) => any;
    }
}
interface Daemon {
    CGI(path: string, conf?: {}): void;
    collection(col: string): Promise<mongodb.Collection>;
    session(options: (Daemon.MongoSessionOptions | Daemon.MongoPromiseSessionOptions)): express.RequestHandler;
    mongodb(): express.RequestHandler;
    _moment(exp: string | number): moment.Moment;
}
declare class Daemon {
    static _init(): void;
    private static _broadcast_message;
    private static _onmessage;
    private static _watch;
    private static _unload;
    private static _trigger;
    private static _triggerload;
    private static _triggerunload;
    private static _require;
    static require(id: string): any;
    private _db;
    private _handlers;
    constructor(uri: string, db: string, username?: string, password?: string);
    handlers(handlers: {}): void;
    private conf;
    hot(id: string): void;
}
export = Daemon;
