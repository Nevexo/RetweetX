/*

    RetweetX Common Functions
    By Cameron Fleming.

*/

export {};

exports.tweets_db_to_user_safe = (db_results: any) => {
    // Converts database response from "tweets" table to user-safe values.

    let new_tweets: Array<Object> = []
    db_results.forEach((tweet: any) => {
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

    return new_tweets;
}