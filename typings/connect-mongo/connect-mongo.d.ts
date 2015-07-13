/// <reference path="../express-session/express-session.d.ts" />
declare module "connect-mongo" {
	import session = require("express-session");
	module c {
		export interface MongoStore extends session.Store {
			new(opt: any): MongoStore;
		}
	}
	function c(session:any): c.MongoStore;
	export = c;
}