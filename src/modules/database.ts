
/*

    RetweetX Database Service.
    By Cameron Fleming.

*/

const MongoClient = require('mongodb').MongoClient;

class Database {
    logger: any;
    config: any;
    manifests: Object;
    state: String = "DISCONNECTED";
    db: any;
    watchdogController: any = false;
    retries: number = 0;
    mainInterupt: any;

    constructor(logger: any, config: Object, manifests: Object, interupt: any) {
        this.logger = logger
        this.config = config
        this.manifests = manifests
        this.logger.debug("Database module constructed.")
        this.mainInterupt = interupt
    }

    // State manager
    private setState(state: string) {
        this.logger.debug(`[DB] Changing connection state from ${this.state} to ${state}`)
        this.state = state
    }

    public getState() {
        return this.state;
    }

    // Establish connection to MongoDB
    private establish(callback: any) {
        this.setState("NOTREADY/ESTABLISHING")
        MongoClient.connect(this.config.database.server, {"useNewUrlParser": true}, (err: Error, client: any) => {
            if (err) {
                this.logger.error(err)
                this.setState("NOTREADY/CONNFAULT")
            }else {
                this.retries = 0
                this.setState("NOTREADY/ESTABLISHED")
                this.db = client.db(this.config.database.database)
                this.setState("READY/CONNECTED")
                this.mainInterupt("DATABASE_LAUNCH")

                callback()
            }
        })
    }

    public insert(collection: String, data: any, callback: any) {
        if (!this.config.database.read_only) {
            const collctx = this.db.collection(collection)
            collctx.insertMany(data, (error: Error, result: any) => {
                callback(error, result)
            })
        }
    }

    public find(collection: String, find: String, callback: any) {
        const collctx = this.db.collection(collection)
        
        collctx.find(find).toArray((error: Error, results: any) => {
            callback(error, results)
        })
    }

    public count(collection: String, find: String, callback: any) {
        const collctx = this.db.collection(collection)
        collctx.count(find, (err: Error, result: any) => {
            callback(err, result)
        })
    }

    // PROMISE VERSION

    public promise_count(collection: String, find: String) {
        const ctx = this.db.collection(collection)
        return ctx.countDocuments(find) // Return promise to caller
    }

    public find_limit(collection: String, find: String, limit: number, callback: any) {
        const collctx = this.db.collection(collection)

        collctx.find(find).limit(limit).toArray((error: Error, results: any) => {
            callback(error, results)
        })
    }

    public find_limit_latest(collection: String, find: String, limit: number, callback: any) {
        const collctx = this.db.collection(collection)

        collctx.find(find).limit(limit).sort({_id: -1}).toArray((error: Error, results: any) => {
            callback(error, results)
        })
    }

    public promise_find_limit_latest(collection: String, find: String, limit: number) {
        const ctx = this.db.collection(collection);
        return ctx.find(find).limit(limit).sort({_id: -1}).toArray()
    }

    public update(collection: String, find: String, update: any, upsert: boolean, callback: any) {
        if (!this.config.database.read_only) {
            const collctx = this.db.collection(collection)

            collctx.updateOne(find, update, upsert, (error: Error, results: any) => {
                callback(error, results)
            })
        }
    }

    public getSettings(callback: any) {
        const settingsCtx = this.db.collection("settings")

        settingsCtx.find().toArray((error: String, results: any) => {
            if (results.length == 0) {
                error = "Missing settings in database!"
            }
            callback(error, results)
        }) 
    }

    // Connection WatchDog
    private startWatchdog() {
        this.watchdogController = setInterval(() => {
            if (this.state != "NOTREADY/ESTABLISHING") { // Only run if not establishing..
            // Runs every second
                if (! this.db.serverConfig.isConnected()) {
                    this.setState("NOTREADY/DISCONNECTED")
                    this.mainInterupt("DATABASE_CONN_FAULT")
                    if ((this.retries >= this.config.database.maxRetries) == false) {
                        this.logger.warn("[DB] Attempting to re-establish DB connection.")
                        this.startDatabase()
                        this.retries++;
                    }else {
                        this.logger.error("[DB] Max retry connections reached. Stopping.")
                        this.stopWatchdog()
                    }
                }
            }

        }, 1000)
        this.logger.debug("[DB] Watchdog has engaged.")
    }

    private stopWatchdog() {
        clearInterval(this.watchdogController)
        this.logger.warn("[DB] Watchdog has disconnected, fault?")
        this.watchdogController = false;
    }
 
    // Public database configuration function
    public startDatabase() {
        this.logger.debug("Request to start DB; please wait.")
        this.establish(() => {
            // Called when established.
            if (this.watchdogController == false) {
                this.startWatchdog()
            }
        })
        // Extra things to be added.
    }
}

exports.Database = Database
