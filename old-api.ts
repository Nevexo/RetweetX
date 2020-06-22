/*

    RetweetX API Service.
    By Cameron Fleming.

*/

const Express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")

class Handlers {
    // Private Class that handles the various routes.
    logger: any;
    config: Object;
    manifests: Object;
    app: any;
    database: any;

    constructor(logger: any, config: Object, manifests: Object, app: any) {
        this.logger = logger;
        this.config = config;
        this.manifests = manifests;
        this.app = app;
    }

    public addDatabase(database: any) {
        this.database = database
    }

    public getContext() {
        // Return object context to the called.
        return this;
    }

    public all(req: any, res: any, next: any, context: any) {
        // All API requests traverse this function
        res.contentType("application/json");
        //this.logger.debug(`API Activity: ${req.hostname} ${req.originalUrl}`)
        // Check authorisation
        
        next()
    }

    public manifest(req: any, res: any, context: any) {
        // Returns the basic manifests for API & Frontend.
        let body: any = {};
        body["applicationManifests"] = {
            "webInterface": context.manifests.web,
            "apiServer": context.manifests.app,
            "branding": context.config.branding
        }
        res.send(body)
    }

    public tweet_count(req: any, res: any, context: any) {
        context.database.count('tweets', {}, (error: Error, tweetCount: any) => {
            if (error) {
                res.sendStatus(500)
            }else {
                res.json({"count": tweetCount})
            }
        })
    } 

    public tweets(req: any, res: any, context: any) {
        if (req.query["limit"] == undefined) {
            res.status(400)
            res.json({"error": "No limit set."})
        }else {
            let query: any = {}
            if (req.query['author'] != undefined) {
                query["author"] = req.query['author']
            }
            if (req.query['author_name'] != undefined) {
                query["author_name"] = req.query['author_name']
            }
            if (req.query['state'] != undefined) {
                query["state"] = req.query['state']
            }
            context.database.find_limit_latest("tweets", query, parseInt(req.query.limit), (error: Error, results: any) => {
                if (error) {
                    this.logger.error(error)
                    res.sendStatus(500)
                }else {
                    // Convert to a nicer format
                    let new_tweets: Array<Object> = []
                    results.forEach((tweet: any) => {
                        new_tweets.push(
                            {
                                "id": tweet.id,
                                "author": tweet.author,
                                "author_name": tweet.author_name,
                                "text": tweet.text.substring(0, 100),
                                "state": tweet.state,
                                "state_reason": tweet.state_reason,
                                "last_change": tweet.state_last_changed
                            }
                        )
                    })
                    res.json({"message": "OK", "data": new_tweets})
                }
            })
        }
    }

    private blacklist(req: any, res: any, context: any) {
        // Blacklist a user

    }

}

class API {
    logger: any;
    config: Object;
    manifests: Object;
    app: any;
    handler: any;
    handlerContext: any;
    router: any;
    database: any;

    constructor(logger: any, config: Object, manifests: Object) {
        // Configure properties
        this.logger = logger
        this.config = config
        this.manifests = manifests
        // Configure Express
        this.app = Express()
	this.app.use(bodyParser.json())
    this.app.use(cors())
    this.app.use(this.handler.checkAuth)

        // Create handler
        this.handler = new Handlers(this.logger, this.config, this.manifests, this.app)
        this.app.use((req: any, res: any, next: any) => this.handler.all(req, res, next))
        // Get context from other objects
        this.handlerContext = this.handler.getContext()

        // Finished Configuration.
        this.logger.debug("API module constructed.")
    }

    public addDatabase(database: any) {
        this.database = database
        this.handler.addDatabase(database)
    }

    private createRoute(method: string, route: string, handler: any) {
        // Operation checks
        let checksPassed: boolean = true;
        if (["get", "post", "patch", "delete"].indexOf(method) == -1) {
            this.logger.error("Code Error: Invalid method " + method)
            checksPassed = false;
        }
        if (handler == undefined) {
            this.logger.error("Code Error: No handler passed (or invalid handler)")
            checksPassed = false;
        }
        // Wow this is bad. But I don't care.
        if (checksPassed) {
            this.app[method](route, (req: any, res: any) => {
                // Request Data, Provisional Response data, Context
                handler(req, res, this.handlerContext)
            })
            this.logger.debug(`[ROUTER] Added route ${method} ${route}`)
        }else {
            this.logger.warn(`[ROUTER] Skipping ${method} ${route}: Check failure. See above errors.`)
        }

        
    }

    private configureRoutes() {
        this.logger.debug("Configuring Routes...")
        this.createRoute("get", "/api/manifests", this.handler.manifest)
        this.createRoute("get", "/api/tweets", this.handler.tweets)
        this.createRoute("get", "/api/stats/tweets", this.handler.tweet_count)
    }

    public configureFakeTweet(handler: any) {
        this.createRoute("post", "/api/faketweet", (req: any, res: any) => {
            handler(req.body)
            res.sendStatus(200)
        })
    }

    public startServer() {
        // Add GET/POST/PATCH Routes to Express Stack.
        this.configureRoutes();
        // Startup Express Server
        this.router = this.app.listen(3000, (err: Error) => {
            // Handle Express Server startup
        })
    }

    public shutdown() {
        this.router.close()
    }
}

exports.API = API
