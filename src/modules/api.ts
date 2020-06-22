/*

    RetweetX API Service 2.
    By Cameron Fleming.

*/

export {};

const Express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const common = require("./common")

class Handlers {
    logger: any;
    config: any;
    manifests: any;
    app: any;
    database: any;
    inject_callback: any;

    constructor(logger: any, config: any, manifests: any, app: any, inject_callback: any) {
        // Logger - logger instance (Winston)
        // Config - config files (json)
        // Manifests - various manifests (usually json)
        // App - express instance
        this.logger = logger;
        this.config = config;
        this.manifests = manifests;
        this.app = app;
        this.inject_callback = inject_callback;
    }

    private get_debug_flag(flag: string, config: any) {
        let flag_state = undefined;

        if (config["debugging"] != undefined) {
            if (config["debugging"][flag] != undefined) {
                return config["debugging"][flag]
            }
        }

        return flag_state
    }

    public add_database_context(DatabaseContext: any) {
        // Add database instance (context)
        this.database = DatabaseContext;
    }

    public get_express_instance() {
        return this.app
    }

    public get_handler_context() {
        // Return context of this class to caller.
        return this;
    }

    public handle_all(req: any, res: any, next: any) {
        // All API calls visit this function, mostly used for authentication and headers.
        // Next is called at the end to continue the flow.
        res.contentType("application/json");
        this.logger.verbose(`API Activity: ${req.hostname} ${req.originalUrl}`)
        next();
    }

    public get_manifests(req: any, res: any, ctx: any) {
        // GET /api/manifests
        // Returns manifests JSON.
        let body: any = {};
        body["applicationManifests"] = {
            "webInterface": ctx.manifests.web,
            "apiServer": ctx.manifests.app,
            "branding": ctx.config.branding
        }
        res.send(body);
    }

    public get_tweet_count(req: any, res: any, ctx: any) {
        // GET /api/tweet_count
        // Return int as part of JSON payload
        ctx.database.promise_count("tweets", {})
        .then((count: number) => {
            res.json({"count": count});
        })
        .catch((error: Error) => {
            ctx.logger.error(error);
            res.sendStatus(500);
        })
    }

    public inject_tweet(req: any, res: any, ctx: any) {
        // POST /api/tweet
        // Adds a new tweet to the system (for testing)
        const debug_settings = ctx.get_debug_flag("tweet_injection", ctx.config)
        if (debug_settings != undefined) {
            if (debug_settings.enable && req.headers.authorization == debug_settings.access_token) {
                // Approved request, forward body to main thread.
                ctx.inject_callback(req.body)
                res.sendStatus(200)
            }else {
                // Pretend we're not home
                res.sendStatus(404)
            }
        }else {
            // Pretend I don't exist
            res.sendStatus(404)
        }
    }

    public get_tweets(req: any, res: any, ctx: any) {
        // GET /api/tweets
        // Queries: *limit*, author, author_name, state

        if (req.query["limit"] == undefined) {
            // Limit is a required query
            res.status(400)
            res.json({"error": "No limit query"})
        }else {
            let query: any = {}
            
            if (req.query["author"] != undefined) {
                // Author passed (this is an ID)
                query["author"] = req.query["author"]
            }

            if (req.query["author_name"] != undefined) {
                // Author_name passed (this is a string)
                query["author_name"] = req.query["author_name"]
            }

            if (req.query["state"] != undefined) {
                // State passed (this is a string)
                query["state"] = req.query["state"]
            }

            // Perform the query
            ctx.database.promise_find_limit_latest("tweets", query, parseInt(req.query["limit"]))
            .then((results: any) => {
                const new_tweets = common.tweets_db_to_user_safe(results);
                // Send new object to user
                res.json({"message": "OK", "data": new_tweets})
            })
            .catch((error: Error) => {
                this.logger.error(error)
                res.sendStatus(500)
            })
        }
    }
} 

class API {
    logger: any;
    config: Object;
    manifests: Object;
    app: any;
    handler: any;
    handler_context: any;
    router: any;
    database: any;

    constructor(logger: any, config: Object, manifests: Object, queue_callback: any) {
        this.logger = logger;
        this.config = config;
        this.manifests = manifests;
        // Setup Router (Express)
        this.app = Express();
        this.app.use(bodyParser.json()); // Used for POST requests
        this.app.use(cors()); // Deal with CORS for me.
        
        // Setup handler
        this.handler = new Handlers(this.logger, this.config, this.manifests, this.app, queue_callback); // Create handler
        this.app.use((req: any, res: any, next: any) => this.handler.handle_all(req, res, next)); // Pass handler (all) to Express
        this.handler_context = this.handler.get_handler_context(); // Return 'this' object from handlers object.

        // Add routes
        //this.app.get("/api/manifests", this.handler.get_manifests)
        //this.app.get("/api/tweet_count", this.handler.get_tweet_count)
        this.add_api_route("get", "/api/manifests", this.handler.get_manifests)
        this.add_api_route("get", "/api/tweet_count", this.handler.get_tweet_count)
        this.add_api_route("get", "/api/tweets", this.handler.get_tweets)
        this.add_api_route("post", "/api/tweet", this.handler.inject_tweet)
    }

    private add_api_route(method: string, endpoint: string, handler: any) {
        this.app[method](endpoint, (req: any, res: any) => {
            handler(req, res, this.handler_context)
        })
    }

    // TODO: Perform this task during construction
    public add_database_instance(database: any) {
        // Add the database context to this module.
        this.database = database;
        this.handler.add_database_context(database);
    }

    public start_http_server() {
        // Start the HTTP Express Server
        // TODO: Express currently doesn't support promise on this endpoint
        // this.router = this.app.listen(3000)
        // .then(() => {
        //     this.logger.info("Started API server on port 3000.");
        // })
        // .catch((error: Error) => {
        //     this.logger.error(error);
        // })
        this.router = this.app.listen(3000, (error: Error) => {
            if (error) {
                this.logger.error(error);
            }else {
                this.logger.info("Started API server on port 3000.")
            }
        })
    }

    public stop_http_server() {
        // Shutdown HTTP server (to stop database corruption during disconnections)
        this.logger.info("Stopping HTTP server.")
        this.router.close();
    }
}

exports.API = API