/// <reference types="node" />
/// <reference types="express" />
import * as express from "express";
declare global  {
    interface Promise<T> {
        spread<TResult1, TResult2>(onfulfilled: (...values: any[]) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2>;
    }
}
import * as mongodb from "mongodb";
import Db = mongodb.Db;
import * as moment from "moment";
declare module Daemon {
    interface SessionOptions {
        db: Db;
        ttl: number;
        touchAfter: number;
        sessionSecret: string;
        stringify: boolean;
    }
    interface Request extends express.Request {
        col: (collectionName: string) => Promise<mongodb.Collection>;
        $find: any;
        find: (col: string, query?: {}, fields?: {}, sort?: {}, skip?: number, limit?: number) => Promise<mongodb.Cursor>;
        _find: (cursor: mongodb.Cursor) => void;
        findOne: <T>(col: string, query: any, fields?: any) => Promise<T>;
        _findOne: <T>(r: T) => void;
        _array: <T>(r: T[]) => void;
        insert: (col: string, op: any, options?: mongodb.CollectionInsertOneOptions) => Promise<mongodb.WriteOpResult>;
        _insert: (r: mongodb.WriteOpResult) => void;
        insertMany: (col: string, docs: any[], options?: mongodb.CollectionInsertManyOptions) => Promise<mongodb.WriteOpResult>;
        save: (col: string, op: any, options?: mongodb.CollectionOptions) => Promise<mongodb.WriteOpResult>;
        _save: (r: mongodb.WriteOpResult) => void;
        update: (col: string, query: any, op: any, options?: mongodb.ReplaceOneOptions & {
            multi?: boolean;
        }) => Promise<mongodb.WriteOpResult>;
        _update: (r: mongodb.WriteOpResult) => void;
        remove: (col: string, query: any, options?: mongodb.CollectionOptions & {
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
    }
    interface Response extends express.Response {
        find: <T>(cursor: mongodb.Cursor) => void;
        findOne: <T>(r: T) => void;
        array: <T>(r: T[]) => void;
        insert: (r: mongodb.InsertOneWriteOpResult) => void;
        insertMany: (r: mongodb.InsertWriteOpResult) => void;
        update: (r: mongodb.WriteOpResult) => void;
        ex: (ex: Error | any) => void;
        $json$options: any;
    }
    interface Route {
        (req: Request, res: Response, ...data: any[]): void;
    }
}
interface Daemon {
    CGI(path: string, conf?: {}): void;
    collection(col: string): Promise<mongodb.Collection>;
    session(options: Daemon.SessionOptions): express.RequestHandler;
    mongodb(): express.RequestHandler;
    _moment(exp: string | number): moment.Moment;
}
declare class Daemon {
    static _init(): void;
    private static _broadcast_message(source, message);
    private static _onmessage(message);
    private static _watch(id, filename);
    private static _unload(message);
    private static _trigger(message);
    private static _triggerload(id, filename);
    private static _triggerunload(id, filename);
    private static _require(id);
    static require(id: string): any;
    private _db;
    private _handlers;
    constructor(connection_string: string, username?: string, password?: string);
    handlers(handlers: {}): void;
    private conf;
    hot(id: string): void;
}
export = Daemon;
