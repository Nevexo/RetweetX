/*

    RetweetX (Mixer-Retweet 2), a better, TypeScript Twitter
    auto-retweeting bot.

    By Cameron Fleming <nevexo@nevexo.space>
*/

const config = require("./config.json")
const manifests = {
    "web": require("./manifests/web_interface.json"),
    "app": require("./manifests/app.json"),
    "rules": require("./manifests/rules.json")
}

const modules = {
    "Twitter": require("./modules/twitter"),
    "RuleEngine": require("./modules/ruleEngine"),
    "Database": require("./modules/database"),
    "API": require("./modules/api"),
    "WebSocket": require("./modules/websocket")
}
const winston = require('winston');
const request = require('request');

// Configure Logging

const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        // winston.format.timestamp({
        //     format: 'YYYY-MM-DD HH:mm:ss'
        // }),
        winston.format.errors({
            stack: true
        }),
        winston.format.simple()
    ),
    // defaultMeta: {"name": manifests.app.name},
    transports: [
        new winston.transports.File({
            filename: `${config.logging.logsDirectory}/error.log`,
            level: 'error'
        }),

        new winston.transports.File({
            filename: `${config.logging.logsDirectory}/combined.log`
        }),

        new winston.transports.Console()
    ]
})

// Show software versions
logger.info("Welcome to RetweetX!")
logger.info(`Author: ${manifests["app"]["author"]}`)
logger.info(`Version: ${manifests["app"]["version"]}`)
console.log("---------------------------------------")


//const twitter = new modules.Twitter.Twitter(logger, config, manifests)
const api = new modules.API.API(logger, config, manifests, (tweet: any) => {
    // Called when the /api/tweet inject is posted to.
    queueTweet(tweet)
})
const ruleEngine = new modules.RuleEngine.RuleEngine(logger, config, manifests)
let settings: any;

const queueTweet = (tweet: any) => {
    const tweet_object = {
        "id": tweet.id_str,                      // Tweet ID as string
        "author": tweet.user.id,                 // Author ID
        "author_name": tweet.user.screen_name,   // Author name
        "text": tweet.text,                      // Tweet text
        "state": "pending",                      // Status of the tweet within RTX
        "state_reason": "not_processed",         // Reason for that state.
        "entities": tweet.entities,              // Add tweet entities (such as URLs)
        "avatar": tweet.user.profile_image_url_https, // Avatar URL
        "extended_tweet": tweet.extended_tweet
    }
    socket.broadcast('tweet_create', tweet_object)
    database.insert("tweets", [tweet_object], (error: Error, result: any) => {
        if (error) {
            logger.error(error)
        }else {
            logger.debug(`Logged new tweet ${tweet_object.id}`)
        }
    })
}

const handler = (tweet: any) => {
    // If errors occur, the tweet will not be queued.
    if (database.getState() == "READY/CONNECTED") {
        // Check if author is in the database
        if (tweet.user == undefined) {
            logger.warn("Twitter Error Message: " + tweet.toString() + " (likely ratelimited)")
        }else {
            logger.debug(`New Tweet: ${tweet.text}`)
            database.find("authors", {"id": tweet.user.id}, (error: Error, results: any) => {
                if (error) {
                    logger.error(error)
                }else {
                    if (results.length == 0) {
                        // User doesn't exist, create one.
                        database.insert("authors", [
                            {
                                "username": tweet.user.screen_name,
                                "id": tweet.user.id,
                                "rtx_status": "OK",
                                "latest_tweet_id": tweet.id,
                                "avatar": tweet.avatar,
                                "tweet_count": 1
                            }
                        ], (err: Error, result: any) => {
                            if (err) {
                                logger.error(`Error creating new user ${err}`)
                            }else {
                                logger.debug(`Created new author: ${tweet.user.screen_name}`)
                                queueTweet(tweet) // Pass tweet to handler
                            }
                        })
                    }else {
                        // User already exists
                        if (results[0]["rtx_status"] != "blacklist") {
                            // Ignore user if they are blacklisted.
                            database.update("authors", 
                            // Find author by ID
                            {"id": tweet.user.id}, 
                            // Change settings for author
                            {$set: {"latest_tweet_id": tweet.id, "tweet_count": results[0]["tweet_count"] + 1, "rtx_status": "pending"}},
                            // Disable upserting.
                            false, 
                            // Handle result
                            (err: Error, result: any) => {
                                if (err) {
                                    logger.error(err)
                                }else {
                                    logger.debug(`Updated author ${tweet.user.screen_name}!`)
                                    queueTweet(tweet) // Pass tweet to handler
                                }
                            })
                        }
                    }
                }
            })
        }
    }else {
        logger.warn("Ignoring Tweet, database unavailable.")
    }
}

const databaseInterupt = (reason: String) => {
    if (reason == "DATABASE_CONN_FAULT") {
        api.stop_http_server()
        twitter.shutdown()
    }
    if (reason == "DATABASE_LAUNCH") {
        if (config.twitter.connect) {
            twitter.start(twitterStreamFault)
        }
        api.start_http_server()
        // Get settings
        database.getSettings((error: Error, Settings: any) => {
            if (error) {
                logger.error(error)
                process.exit(1)
            }else {
                logger.debug(`Loaded settings: ${JSON.stringify(Settings[0])}`)
                settings = Settings[0]
                ruleEngine.setSettings(settings)
                startRuleEngineLoop()
            }
        })
    }
}

const twitterStreamFault = () => {
    // Handler for the watchdog / stream to call on error condition
    socket.broadcast('message', {"message": "Restarting Twitter Stream"})
    logger.info("Restarting Twitter Stream in 30 seconds.")
    twitter.shutdown()
    // Reset 5 seconds later
    setTimeout(() => {
        twitter.start(twitterStreamFault)
    }, 30000)
}

const ruleEngineHandler = () => {
    // Find pending tweets
    database.find("tweets", {"state": "pending"}, (error: Error, results: any) => {
        if (error) {
            logger.error(error)
        }else {
            if (results.length == 0) {
                // No tweets pending.
                logger.debug("No tweets pending")
            }else {
                // Found some pending tweets
                logger.debug(`System has ${results.length} pending tweets.`)
                socket.broadcast('stat_update', {"pending_tweets": results.length})
                // Run the rule engine on oldest message & set it to checking
                // let tweet = results[results.length - 1]
                results.forEach((tweet: any) => {
                    logger.verbose("Verify Tweet: " + tweet.id)
                    ruleEngine.runChecks(tweet).then(() => {
                        // All checks passed
                        logger.verbose(`[Rule Engine] All checks passed on processed message, ID: ${tweet.id}, author name: ${tweet.author_name}`)
                        socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "dispatch_queue"})
                        database.update("tweets", {"_id": tweet._id}, {$set: {"state": "dispatch_queue", "state_reason": "rule_engine_pass", "state_last_changed": new Date()}},
                        (error: Error, results: any) => {
                            if (error) {
                                logger.error("[Rule Engine] Failed to update state in database.")
                                logger.error(error)
                            }
                        })
                    }).catch((checks: any) => {
                        // A/multiple checks failed
                        // Checks (object) contains a list of failed/successful checks.
                        logger.verbose(`[Rule Engine] One or more checks failed on message, ID: ${tweet.id}, author name: ${tweet.author_name}, Message: ${tweet.text}, Checks: ${JSON.stringify(checks)}`)
                        // Update database
                        //logger.verbose(JSON.stringify(tweet))
                        socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "failed", "state_reason": checks})
                        database.update("tweets", {"_id": tweet._id}, {$set: {"state": "failed", "state_reason": checks, "state_last_changed": new Date()}},
                        (error: Error, results: any) => {
                            if (error) {
                                logger.error("[Rule Engine] Failed to update state in database.")
                                logger.error(error)
                            }
                        })
                        
                        // Set author to OK state as long as they're not already blacklisted.
                        if (checks["user_blacklisted"] != undefined) {
                            if (checks["user_blacklisted"] == "pass") {
                                // User was not blacklisted, set them to OK.
                                database.update("authors", {"id": tweet.author}, {$set: {"rtx_status": "OK"}},
                                (error: Error) => {
                                    if (error) {
                                        logger.error("[Rule Engine] Failed to update author status in database. !! !! !!")
                                        logger.error(error)
                                    }
                                })
                            }
                        }else {
                            // Check wasn't set to true, this is a fault in the software.
                            logger.warn("Warning! User blacklist checking is disabled! Some users may be removed from blacklist by accident!")
                            database.update("authors", {"id": tweet.author}, {$set: {"rtx_status": "OK"}},
                            (error: Error) => {
                                if (error) {
                                    logger.error("[Rule Engine] Failed to update author status in database. !! !! !!")
                                    logger.error(error)
                                }
                            })
                        }
                    })
                })
            }
        }
    })
}

const dispatchHandler = () => {
    // Find pending tweets and dispatch them.
    database.find("tweets", {"state": "dispatch_queue"}, (error: Error, results: any) => {
        if (error) {
            logger.info("Failed to get list of queued Tweets.")
            logger.error(error)
        }else {
            // Delete tweets over 15 minutes old
            results.forEach((tweet: any) => {
                let last_changed = tweet["state_last_changed"]
                if (new Date(last_changed).getTime() + settings["deleteOlderThan"] < new Date().getTime()) {
                    socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "expired"})
                    logger.verbose(`Deleting ${tweet.id} from Tweet queue as it's older than ${settings["deleteOlderThan"]}ms.`)
                    database.update("tweets", {"id": tweet.id}, {$set: {"state": "failed", "state_reason": "TweetExpired"}},
                    (error: Error) => {
                        if (error) {
                            logger.error("[Rule Engine] Failed to delete expired Tweet!")
                            logger.error(error)
                        }
                    })
                }
                
            })
            logger.debug(`System has ${results.length} queued tweets.`)
            socket.broadcast('stat_update', {"queued_tweets": results.length})
            // Pick random tweet
            if (results.length != 0) {
                let tweet = results[Math.floor(Math.random()*results.length)];

                // Attempt to retweet
                if (!settings.disableRetweeting) {
                    twitter.retweet(tweet.id).then((retweet_id: String) => {
                        // Expecting retweet ID to the be the ID of the retweet (so it can be deleted later)
                        // Update status in database
                        socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "retweeted"})
                        database.update("tweets", {"id": tweet.id}, {$set: {"state": "retweeted",
                            "state_reason": "sent",
                            "state_last_changed": new Date(),
                            "retweet_id": retweet_id}},
                        (error: Error) => {
                            if (error) {
                                logger.error("[Rule Engine] Failed to update state in database.")
                                logger.error(error)
                            }
                        })
                        // Update author to 'OK' state
                        socket.broadcast('author_state_update', {"id": tweet.author, "state": "OK"})
                        database.update("authors", {"id": tweet.author}, {$set: {"rtx_status": "OK"}},
                        (error: Error) => {
                            if (error) {
                                logger.error("[Rule Engine] Failed to update author status in database. !! !! !!")
                                logger.error(error)
                            }
                        })
                        // Fire any notifications
                        //  -> Webhooks
                        config.notification.webhooks.forEach((hookUrl: string) => {
                            request.post({url: hookUrl, json: {
                                "content": `Just Retweeted: https://twitter.com/${tweet.author_name}/status/${tweet.id}`
                            }}, (error: Error, response: any, body: any) => {
                                if (error) {
                                    logger.warn(`Failed to fire webhook: ${hookUrl}`)
                                    logger.error(error)
                                }else {
                                    logger.verbose(`Fired Webhook: ${hookUrl}`)
                                }
                            })
                        })
                    }).catch((error: Error) => {
                        logger.error(error)
                        logger.warn("Failed to Retweet " + tweet.id + " error logged.")
                        socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "failed"})
                        database.update("tweets", {"id": tweet.id}, {$set: {"state": "failed",
                        "state_reason": "retweet_failed",
                        "state_last_changed": new Date()}},
                        (error: Error) => {
                            if (error) {
                                logger.error("[Rule Engine] Failed to update state in database.")
                                logger.error(error)
                            }
                        })
                    })
                }else {
                    logger.warn(`Not retweet ${tweet.id} as retweeting is disabled.`)
                    socket.broadcast('tweet_state_update', {"id": tweet.id, "state": "retweet_disabled"})
                }
            }

        }
    })
}

const startRuleEngineLoop = () => {
    // Start the RuleEngine check loop
    let ruleEngineLoop = setInterval(ruleEngineHandler, 5000)
    let dispatchLoop   = setInterval(dispatchHandler, settings["dispatchTime"])
    logger.info("Started main loop!")
}

const twitter = new modules.Twitter.Twitter(logger, config, manifests, handler)
const database = new modules.Database.Database(logger, config, manifests, databaseInterupt)
const socket = new modules.WebSocket.SocketService(logger, config, database);
api.add_database_instance(database)
ruleEngine.addDatabase(database)

database.startDatabase()
