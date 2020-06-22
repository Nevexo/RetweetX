/*

    RetweetX WebSocket Service
    By Cameron Fleming.

*/

export {};

const ws = require("ws")
const common = require("./common")

class SocketService {
    logger: any;
    config: any;
    wss: any;
    database: any;
    
    constructor(logger: any, config: any, database: any) {
        this.logger = logger;
        this.config = config;
        this.database = database;

        if (config.service.websocket.enable) {
            logger.verbose("Starting WebSocket Server")

            // Setup ws
            this.wss = new ws.Server({
                port: config.service.websocket.port,
            })

            // Setup handlers
            this.wss.on('connection', (ws: any) => {
                this.ws_send(ws, "hello", {"message": "Welcome to RetweetX."})
                ws.on('message', (message: any) => {
                    try {
                        message = JSON.parse(message)
                        this.handle_websocket_message(message, ws)                    
                    }catch (error) {
                        logger.error("WebSocket Error: " + error);
                        this.ws_send(ws, "invalid_request", {"message": "Expected JSON message."})
                    }

                })
            })
        }

    }

    private check_formatted_message(message: any) {
        let i: boolean = false;

        if (typeof message == "object") {
            if (message["cmd"] != undefined && message["data"] != undefined) {
                if (typeof message["cmd"] == "string" && typeof message["data"] == "object") {
                    i = true
                }
            }
        }
        return i
    }

    private ws_send(ws: any, cmd: String, data: Object) {
        if (ws.readyState === ws.OPEN) {
            const payload = {"cmd": cmd, "data": data}
            this.logger.debug(`WebSocket: > ${JSON.stringify(payload)}`)
            ws.send(JSON.stringify(payload));
            return true;
        }else {
            return false;
        }
    }

    private handle_websocket_message(message: any, ws: any) {
        if (this.check_formatted_message(message)) {
            this.logger.debug(`WebSocket: < ${JSON.stringify(message)}`)
            switch (message["cmd"]) {
                case 'ping':
                    this.send_ping_response(ws);
                    break;
                case 'disconnect':
                    ws.close();
                    break;
                case 'get_tweets':
                    this.get_pending_tweets(ws, message['data'])
                    break;
                default:
                    this.ws_send(ws, "invalid_request", {"message": `The requested opcode ${message["cmd"]} is invalid.`})
                    break;
            }
        }else {
            this.ws_send(ws, "invalid_request", {"message": `Expected {'cmd': 'opcode', 'data': {}}`})
        }
    }

    private send_ping_response(ws: any) {
        this.ws_send(ws, "ping_response", {"message": "Pong!", "time": new Date().toISOString()})
    }

    private send_ack(ws: any, message: String) {
        // Used while the database is busy
        this.ws_send(ws, "ack", {"message": message})
    } 

    private get_pending_tweets(ws: any, data: any) {
        if (typeof data["count"] == 'number') {
            this.send_ack(ws, "Collecting data from the database")
            this.database.promise_find_limit_latest("tweets", {}, data["count"])
            .then((results: any) => {
                const tweets = common.tweets_db_to_user_safe(results)
                this.ws_send(ws, "pending_tweets_update", {"tweets": tweets})
            })

        }else {
            this.ws_send(ws, "invalid_request", {"message": "Expecting 'count' in data payload as NUMBER."})
        }
    }

    public broadcast(cmd: string, data: object) {
        this.wss.clients.forEach((client: any) => {
            this.ws_send(client, cmd, data)
        });
    }
}

exports.SocketService = SocketService;