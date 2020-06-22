# /api/tweets

> 200 OK: JSON response
> 401 UNAUTHORIZED

`json
{
    "id": tweet.id,
    "author": tweet.author,
    "author_name": tweet.author_name,
    "text": tweet.text.substring(0, 100),
    "state": tweet.state,
    "state_reason": tweet.state_reason,
    "last_change": tweet.state_last_changed
}
`

