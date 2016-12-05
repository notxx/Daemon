/// <reference path="typings/express/express.d.ts" />
/// <reference path="typings/mongodb/mongodb.d.ts" />
/// <reference path="typings/moment/moment.d.ts" />
import express = require("express");
import mongodb = require("mongodb");
declare module "Daemon" {
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
	interface InsertManyResult {
		insertedCount: number;
		insertedIds: any[];
		ops: any[];
		result: { ok: number; n: number; }
	}
	interface Request extends express.Request {
		col:<T>(collectionName:string) => Promise<mongodb.Collection<T>>;
		$find:any;
		find:<T>(col:string, query?:{}, fields?:{}, sort?:{}, skip?:number, limit?:number) => Promise<mongodb.Cursor<T>>;
		_find:<T>(cursor:mongodb.Cursor<T>) => void;
		findOne:<T>(col:string, query:any, fields?:any) => Promise<T>;
		_findOne:<T>(r:T) => void;
		_array:<T>(r:T[]) => void;
		insert:(col:string, op:any, options?:{ safe?: any; continueOnError?: boolean; keepGoing?: boolean; serializeFunctions?: boolean; }) => Promise<InsertResult>;
		_insert:(r:InsertResult) => void;
		insertMany:(col:string, docs:any[], options?:{ w?: number|string; wtimeout?: number; j?: boolean; serializeFunctions?: boolean; forceServerObjectId?: boolean; }) => Promise<InsertManyResult>;
		save:<T>(col:string, op:T, options?:{ safe: any }) => Promise<UpdateResult>;
		_save:<T>(r:UpdateResult) => void;
		update:(col:string, query:any, op:any, options?:{ safe?: boolean; upsert?: any; multi?: boolean; serializeFunctions?: boolean; }) => Promise<UpdateResult>;
		_update:(r:UpdateResult) => void;
		remove:(col:string, op:any, options?:{ safe?: any; single?: boolean; }) => Promise<UpdateResult>;
		_remove:(r:UpdateResult) => void;
		findAndModify:(col:string, query:any, sort:any[], op:any, options?:{ safe?: any; remove?: boolean; upsert?: boolean; new?: boolean; }) => Promise<UpdateResult>;
		_ex: (ex:Error | {}) => void;
	
		_export:(data:any, name:string[]) => void;
		_exportInt:(data:any, name:string[]) => void;
	}
	interface Response extends express.Response {
		find:<T>(cursor:mongodb.Cursor<T>) => void;
		findOne:<T>(r:T) => void;
		array:<T>(r:T[]) => void;
		insert:(r:InsertResult) => void;
		insertMany:(r:any) => void;
		update:(r:UpdateResult) => void;
		ex: (ex:Error | any) => void;
		$json$options: any;
	}
	interface Route {
		(req: Request, res: Response, ...data:any[]): void;
	}
	function CGI(path: string, conf?: {}): void
	function collection<T>(col:string): Promise<mongodb.Collection<T>>
	function session(options: SessionOptions): express.RequestHandler
	function mongodb(): express.RequestHandler
	function _moment(exp:string|number): moment.Moment

}
declare class Daemon {
	constructor(connection_string: string, username?: string, password?: string)
}
export = Daemon
