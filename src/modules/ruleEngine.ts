/*

    RetweetX RuleEngine Service.
    By Cameron Fleming.

*/

class RuleEngine {
    logger: any;
    config: any;
    manifests: any;
    checks: any = {};
    settings: any = {};
    database: any;

    constructor(logger: any, config: Object, manifests: Object) {
        this.logger = logger
        this.config = config
        this.manifests = manifests
        this.logger.debug("RuleEngine module constructed.")
    }

    public addDatabase(database: any) {
        this.database = database
    }

    public setSettings(Settings: any) {
        this.settings = Settings
        if (Settings["disableRetweeting"] == "true") {
            this.logger.warn("Disable retweeting is set to true. The ruleEngine will always reject tweets.")
        }
    }

    private check_isRetweet(tweet: any, callback: Function) {
        // Resolves if the tweet passes/fails, rejects if the test fails.
        // LMAO this is so fucking hacky and I don't care.
        if (tweet.text.startsWith("RT ")) {
            this.checkState("is_retweet", "fail")
        }else {
            this.checkState("is_retweet", "pass")
        }
    }

    private check_containsStrongLanguage(tweet: any, callback: Function) {
        // Expects tweet, returns "pass" if the tweet doesn't contain extremely strong language.
        let state = "pass"
        this.manifests.rules.strongLanguage.forEach((word: string) => {
            if (tweet.text.includes(word)) {
                state = "fail"
            }
        })
        this.checkState("strong_language", state)
    }

    private check_userFollowing(tweet: any, callback: any) {
        // Expects a tweet, returns "pass" if the user is following the bot, fail if not
        // Pass sent if the bot is under ratelimit.

    }

    private checkState(check: string, status: string) {
        this.checks[check] = status
    }

    private check_brandingUrl(tweet: any) {
        // Checks if a required URL is in a tweet (i.e mixer.com/)
        let state = "fail"
        if (tweet.entities != undefined) {
            tweet.entities.urls.forEach((url: any) => {
                if (url.expanded_url.toLowerCase().includes(this.config.branding.url)) {
                    state = "pass"
                }
            })
        }
        if (tweet["extended_tweet"] != undefined) {
            tweet["extended_tweet"].entities.urls.forEach((url: any) => {
                if (url.expanded_url.toLowerCase().includes(this.config.branding.url)) {
                    state = "pass"
                }
            })
        }
        this.checkState("branding_url_missing", state)

    }
    
    private check_userBlacklist(tweet: any) {
        // Checks if a user is blacklisted or not
        this.database.find("authors", {"id": tweet.author}, (error: Error, results: any) => {
            if (error) {
                this.logger.error("[Rule Engine] Error finding author")
                this.logger.error(error)
                // Fail the tweet.
                this.checkState("user_blacklisted", "fail")
            }else {
                if (results[0]["rtx_status"] == "pending" || results[0]["rtx_status"] == "OK") {
                    this.checkState("user_blacklisted", "pass")
                }else {
                    this.checkState("user_blacklisted", "fail")
                }
            }
        })
    }

    public runChecks(tweet: any) {
        this.checks = {}
        return new Promise((resolve: any, reject: any) => {
            // Run all checks on a tweet.
            if (this.settings["ignoreRetweet"] == true) {
                this.checks["is_retweet"] = "not_checked"
                this.check_isRetweet(tweet, this.checkState)
            }
            if (this.settings["ignoreExtremeLanguage"] == true) {
                this.checks["strong_language"] = "not_checked"
                this.check_containsStrongLanguage(tweet, this.checkState)
            }
            if (this.settings["requireBrandingUrl"] == true) {
                this.checks["branding_url_missing"] = "not_checked"
                this.check_brandingUrl(tweet)
            }
            if (this.settings["userNotBlacklisted"] == true) {
                this.checks["user_blacklisted"] = "not_checked"
                this.check_userBlacklist(tweet)
            }
            // Check if the checks completed
            setTimeout(() => {
                let ruleEngineLoop = setInterval(() => {
                    // Check every 500ms if the checks are done
                    let allComplete = true; // Set false if any checks haven't yet completed.
                    for (let check in this.checks) {
                        if (this.checks.hasOwnProperty(check)) {
                            if (this.checks[check] == "not_checked") {
                                allComplete = false;
                            }
                        }
                    }
                    if (allComplete) {
                        clearInterval(ruleEngineLoop)
                        // NYI: [TODO] Add overall status and callback.
                        let allSuccess = true;
                        for (let check in this.checks) {
                            if (this.checks.hasOwnProperty(check)) {
                                if (this.checks[check] == "fail") {
                                    allSuccess = false;
                                }
                            }
                        }   
                        if (allSuccess) {
                            resolve(true)
                        }else {
                            reject(this.checks)
                        }
                    }
                })
            }, 100)
        })
    }
}

exports.RuleEngine = RuleEngine