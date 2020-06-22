import requests
import time

def display(data):
    print("------------------")
    pending = 0
    dispatching = 0
    dispatched = 0
    failed = 0
    count = 0
    for tweet in data:
        count += 1
        if tweet["state"] == "pending":
            pending += 1

        elif tweet["state"] == "dispatch_queue":
            dispatching += 1
        
        elif tweet["state"] == "retweeted":
            dispatched += 1
        
        elif tweet["state"] == "failed":
            failed += 1
        
        else:
            print(tweet["state"])

    print(f"In Database: {count}")    
    print(f"Pending: {pending}")
    print(f"Dispatching: {dispatching}")
    print(f"Dispatched: {dispatched}")
    print(f"Failed: {failed}")

r = requests.get("http://172.16.2.4:3000/api/tweets")
if r.status_code == 200:
    display(r.json())
else:
    print("Error.")

