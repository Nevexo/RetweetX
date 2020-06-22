
/*

    RetweetX Twitter Service.
    By Cameron Fleming.

*/

const TwitterInstance = require("twitter")

class Twitter {
    logger: any;
    config: any;
    manifests: Object;
    client: any;
    tweetHandler: any;
    tweetStream: any = false;
    lastDataEpoch: number = 0;
    wdInterval: any;

    constructor(logger: any, config: Object, manifests: Object, tweetHandler: Function) {
        this.logger = logger
        this.config = config
        this.manifests = manifests
        this.logger.debug("Twitter module constructed.")
        this.client = new TwitterInstance(this.config.twitter)
        this.tweetHandler = tweetHandler
    }

    public start(errorHandler: any) {
        this.logger.warn("----[ S T R E A M  S T A R T ]----")
        //Start the service, only to be done once the database loads up.
        this.lastDataEpoch = Date.now();
        this.tweetStream = this.client.stream('statuses/filter', {track: this.config.twitter.track});
        this.tweetStream.on('data', (data: any) => {
            //console.dir(data)
            this.lastDataEpoch = Date.now();
            if (data.user.id_str != this.config.twitter.id) {
                if (data["in_reply_to_status_id"] == null) {
                    this.tweetHandler(data)                    
                }
            }else {
                this.logger.debug("Ignoring own tweet: " + data.id_str)
            }
        })
        this.tweetStream.on('error', (error: Error) => {
            this.logger.error("Twitter Error!")
            this.logger.error(error)
            errorHandler();
        })
        this.logger.debug("Now Tracking: " + this.config.twitter.track)
        this.startWatchdog(errorHandler)
    }

    private watchdogTick(woofCallback: any) {
        // If no data has been collected in 5 mins, bark
        let diff = Date.now() - this.lastDataEpoch
        if (Math.floor(diff/1000) > 300) {
            this.logger.warn("[Watchdog] BARK! 300 seconds since last stream data. Resetting.")
            woofCallback()
        }
    }

    public startWatchdog(woofCallback: any) {
        this.logger.verbose("[Watchdog] Woof! Watchdog engage.")
        this.wdInterval = setInterval(() => {this.watchdogTick(woofCallback)}, 100)
    }

    public retweet(id: any) {
        // Retweet a selected Tweet (if possible)
        // Returns a promise that is used to update the database status in the main thread
        return new Promise((resolve: any, reject: any) => {
            this.client.post("statuses/retweet/" + id, (error: Error, response: any) => {
                if (error) {
                    this.logger.info("Failed to retweet " + id + " - error logged")
                    this.logger.error(JSON.stringify(error))
                    reject("retweet_fail")
                }else {
                    this.logger.verbose("Retweeting " + id)
                    if (response.retweeted) {
                        this.logger.info("Successfully retweeted " + id)                    
                        resolve(response.id_str)
                    }
                }
            })
        })
    }

    public shutdown() {
        this.logger.warn("----[ S T R E A M  S H U T D O W N ]----")
        clearInterval(this.wdInterval)
        this.tweetStream.destroy();
    }
}

exports.Twitter = Twitter