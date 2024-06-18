const express = require('express');
const WebSocket = require('ws');
const https = require('https');
const winston = require('winston');
const fs = require('fs');
const mysql = require('mysql2/promise');
const PriorityQueue = require('js-priority-queue');
const EventEmitter = require('events');

class MyEmitter extends EventEmitter {}
class roomManager {
    constructor() {
        this.rooms = new Map();
    }

    addRoom(roomid, roomState) {
        this.rooms.set(roomid, roomState);
    }
}

class roomState {
    constructor(AC_status, temperature, enviroment) {
        this.AC_status = AC_status;
        this.temperature = temperature;
        this.enviroment = enviroment;
    }
}

class clientsManager {
    constructor(rooms, RM) {
        this.rooms = rooms;
        this.RM = RM;
        this.clients = new Set();
        this.admins = new Set();
        this.tickAway();
    }

    broadCast(target, message) { 
        target.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        })
    }

    tickAway() {
        setInterval(() => {
            
            simulatedTime += 1;
            //当前时间
            logger.debug(`ServerTime: ${simulatedTime}`);

            //房间状态
            logger.debug("Rooms:");
            this.rooms.forEach((data, roomid) => {
                logger.debug(`[Room${roomid}](${data.AC_status}): ${data.temperature}`);
                this.broadCast(this.admins, JSON.stringify({ type: 'RoomsTable', room: `${roomid}`, temperature: `${data.temperature}`, AC_status: `${data.AC_status}`}));
            });

            //请求状态
            logger.debug("Requests:");
            this.RM.requests.forEach(request => {
                logger.debug(`From [Room${request.room}(${this.rooms.get(request.room).AC_status})](temperature: ${request.current_temperature} wind: ${request.priority} serviceTime: ${request.serviceTime}): ${request.target_temperature}-----waiting ${request.waitingTime}------timeslice ${request.timeslice} ${request.timeslice_time}`);
            });

            //正在服务请求
            logger.debug(`ActiveQueue: ${this.RM.active_queue.length}`);

            //等待服务请求
            logger.debug(`WaitingQueue: ${this.RM.waiting_queue.length}`);

            this.RM.requests.forEach(request => {
                request.socketid.send(JSON.stringify({type: 'TemperatureUpdate', data: request.current_temperature}));
            });
            this.broadCast(this.clients, JSON.stringify({ type: 'MinutePassed', time: simulatedTime}));
            myEmitter.emit('MinutePassed', simulatedTime);
        }, 1000);
    }

    addClient(ws, role) {
        if (role === 'admin') {
            this.admins.add(ws);
        } else if (role === 'user') {
            this.clients.add(ws);
        }
    }

    removeClient(ws) {
        if (role === 'admin') {
            this.admins.delete(ws);
        } else if (role === 'user') {
            this.clients.delete(ws);
        }
    }
}



class request {
    constructor(socketid, room, current_temperature, target_temperature, priority) {
      this.socketid = socketid;
      this.room = room;
      this.current_temperature = current_temperature;
      this.target_temperature = target_temperature;
      this.priority = priority;
      this.serviceTime = 0;
      this.waitingTime = 0;
      this.timeslice = false;
      this.timeslice_time = 0;
    }
}
  
class requestManager {
    constructor(rooms, mode, maxServingRequests) {
        this.rooms = rooms;
        this.mode = mode;
        this.maxServingRequests = maxServingRequests;
        this.requests = new Set();

        //优先退出active_request,进入
        this.active_queue = new PriorityQueue({
            comparator: (a, b) => {
                if (b.priority === a.priority) {
                    return b.serviceTime - a.serviceTime; // 同优先级下，服务时间短的优先
                }
                return a.priority - b.priority;
            }
        })
        this.active_queue_template = new Set();

        //优先进入active_request
        this.waiting_queue = new PriorityQueue({
            comparator: (a, b) => {
                if (b.priority === a.priority) {
                    return b.waitingTime - a.waitingTime; // 同优先级下，服务时间短的优先
                }
                return b.priority - a.priority;
            }
        });
        this.waiting_queue_template = new Set();
        this.TIME_SLICE = 2;
        this.WAITING_LONG = 3;
    }

    running() {
        //处理响应
        while(this.active_queue.length > 0) {
            let serve_request =  this.active_queue.dequeue();
            this.processRequest(serve_request);

            if (Math.abs(serve_request.current_temperature - serve_request.target_temperature) < 0.1) {
                this.waiting_queue_template.delete(serve_request);
                this.rooms.get(serve_request.room).AC_status = 'rest';

                //serve_request已经出队列
            } else {
                let ifexist = false;
                this.active_queue_template.forEach((a_e_request) => {
                    if (a_e_request.room === serve_request.room) {
                        a_e_request.target_temperature = serve_request.target_temperature;
                        a_e_request.current_temperature = serve_request.current_temperature;
                        a_e_request.priority = serve_request.priority;
                        a_e_request.serviceTime = serve_request.serviceTime;
                        ifexist = true;
                    }
                });
        
                if (!ifexist) {
                    this.active_queue_template.add(serve_request);
                }
            }
        }
        this.active_queue_template.forEach((a_e_request) => {
            logger.info(`${a_e_request.room} is in active template`)
            this.active_queue.queue(a_e_request);
        });
        
        //处理等待
        while(this.waiting_queue.length > 0) {
            let wait_request =  this.waiting_queue.dequeue();
            let ifexist = false;
            
            if(wait_request != 0) {
                wait_request.waitingTime -= 1;
            }

            if (wait_request.timeslice != 0) {
                wait_request.timeslice_time -= 1;
            }
            if (wait_request.timeslice === true && wait_request.timeslice_time === 0) {
                //如果是时间片轮转
                let release_request = this.active_queue.dequeue();

                //原来的wait_request 要进入active
                
                wait_request.timeslice = false;
                wait_request.timeslice_time = 0;
                wait_request.waitingTime = 0;
                this.waiting_queue_template.delete(wait_request);
                this.rooms.get(wait_request.room).AC_status = 'working';
                this.active_queue.queue(wait_request);

                //现在的release_request要进入waiting
                release_request.waitingTime = 3;
                this.rooms.get(release_request.room).AC_status = 'waiting';
                this.waiting_queue.queue(release_request);
                this.active_queue_template.delete(release_request);
            }
            //到达等待服务时长
            if (wait_request.waitingTime === 0 && !wait_request.timeslice) {

                //非时间片轮转，寻常调度
                this.active_queue.queue(wait_request);
                let release_request = this.active_queue.dequeue();

                if (wait_request.room == release_request.room) {
                    wait_request.waitingTime = this.WAITING_LONG;

                } else {
                    if (wait_request.priority === release_request.priority) {   
                        release_request.timeslice = true;
                        release_request.timeslice_time = this.TIME_SLICE;
                        release_request.waitingTime = this.WAITING_LONG;

                    }
                    wait_request.waitingTime = 0;
                    this.rooms.get(wait_request.room).AC_status = 'working';
                    this.rooms.get(release_request.room).AC_status = 'waiting';
                    this.waiting_queue.queue(release_request);
                    this.active_queue_template.delete(release_request);
                    this.waiting_queue_template.delete(wait_request);
                }
                wait_request = release_request;
            }
                
            this.waiting_queue_template.forEach((w_e_request) => {
                logger.debug(`${w_e_request.room} is in waiting template`)
                if (w_e_request.room === wait_request.room) {
                    w_e_request.target_temperature = wait_request.target_temperature;
                    w_e_request.current_temperature = wait_request.current_temperature;
                    w_e_request.priority = wait_request.priority;
                    w_e_request.waitingTime = wait_request.waitingTime;
                    ifexist = true;
                }
            });
    
            if (!ifexist) {
                this.waiting_queue_template.add(wait_request);
            }
        }
        this.waiting_queue_template.forEach((wait_request) => {
            this.waiting_queue.queue(wait_request);
        });

        //处理回温
        this.requests.forEach((request) => {
            let room_state = this.rooms.get(request.room).AC_status;

            if (room_state === 'rest') {
                //回温
                if (this.mode === 'heat' && this.rooms.get(request.room).temperature - this.rooms.get(request.room).enviroment > 0.001) {
                    this.rooms.get(request.room).temperature -= 0.5;
                } else if (this.mode === 'cold' && this.rooms.get(request.room).enviroment - this.rooms.get(request.room).temperature > 0.001) {
                    this.rooms.get(request.room).temperature += 0.5;
                }
                logger.debug(`[Room${request.room}](${request.current_temperature}) -> (${this.rooms.get(request.room).temperature})`);
                request.current_temperature = this.rooms.get(request.room).temperature;
                //rest后重新调度
                if (Math.abs(request.current_temperature - request.target_temperature) > 3) {
                    this.rooms.get(request.room).AC_status = 'waiting';
                    logger.debug(`Room[${request.room}] back to waiting`)
                    this.waiting_queue.queue(request);
                }
            }
        });

        this.schedule();

    }

    schedule() {
        this.requests.forEach((e_request) => {
            if(this.rooms.get(e_request.room).AC_status === 'on') {
                e_request.waitingTime = this.WAITING_LONG;
                this.rooms.get(e_request.room).AC_status = 'waiting';
                logger.debug(`Add Room[${e_request.room}] to waiting queue`)
                this.waiting_queue.queue(e_request);
            }
        });

        while (this.active_queue.length < this.maxServingRequests && this.waiting_queue.length > 0) {
            let ready_request = this.waiting_queue.dequeue();
            this.active_queue.queue(ready_request);
            this.rooms.get(ready_request.room).AC_status = 'working';
            ready_request.waitingTime = 0;
        }
    }

    processRequest(serving_request) {
        logger.info(`Serving Room${serving_request.room}(current: ${serving_request.current_temperature})`);
        
        if (this.mode === 'cold') {
            serving_request.current_temperature -= 0.5;
        } else {
            serving_request.current_temperature += 0.5;
        }
        
        logger.info(`Serving Room${serving_request.room}(changed: ${serving_request.current_temperature})`);
        this.rooms.get(serving_request.room).temperature = serving_request.current_temperature;
        serving_request.serviceTime += 1;

    }

    newRequest(new_request) {
        let existing_request = null;

        this.requests.forEach(request => {
            if (request.room === new_request.room) {
                existing_request = request;
            }
        });

        if (existing_request) {
            existing_request.target_temperature = new_request.target_temperature;
            existing_request.current_temperature = new_request.current_temperature;
            existing_request.priority = new_request.priority;
            logger.debug(`[RequestUpdate] update ${existing_request.room}`);
        } else {
            this.requests.add(new_request);
        }
    }
}

const myEmitter = new MyEmitter();

const logger = winston.createLogger({
	level: 'debug',
	format: winston.format.combine(
		winston.format.printf(info => `[${info.level}]: ${info.message}`)
	),
	transports: [
		new winston.transports.Console(),
		new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
		new winston.transports.File({ filename: 'logs/runtime.log'})
	],
});

const pool = mysql.createPool({
    connectionLimit: 10, 
    host: 'localhost',
    user: 'antaresz',
    database: 'HACC',
    password: 'antaresz.cc'
});

const port = 42133;
const app = express();
const https_options = {
	key: fs.readFileSync('/home/antaresz/Projects/GPOS/Cert/privkey.pem'),
	cert: fs.readFileSync('/home/antaresz/Projects/GPOS/Cert/fullchain.pem')
};
const server = https.createServer(https_options, app).listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});
const wss = new WebSocket.Server({ server });

let mode = 'cold';
let simulatedTime = 0;
const rooms = new roomManager();
const RM = new requestManager(rooms.rooms, mode, 2);
const CM = new clientsManager(rooms.rooms, RM);


wss.on('connection', (ws) => {
    logger.info(`WebSocket server is running on wss://www.antaresz.cc:${port}`);
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (data.type === 'login') {
                if (data.role === 'user') {
                    logger.info(`User in Room[${data.room}] loged in`);
                    const room = new roomState(data.AC_status, data.temperature, data.enviroment);
                    
                    rooms.addRoom(data.room, room);
                } else if (data.role === 'admin') {
                    logger.info("one admin loged in");
                }
                CM.addClient(ws, data.role);
                ws.send(JSON.stringify({ type: 'response', data: 'successfully login'}));
            } else if (data.type === 'ACON') {
                const query_room_state = rooms.rooms.get(data.room);
                if (query_room_state.AC_status === 'off') {
                    rooms.rooms.get(data.room).AC_status = 'on';
                }
            } else if (data.type === 'ACOFF') {
                rooms.rooms.get(data.room).AC_status = 'off';
            } else if (data.type === 'request') {
                const new_request = new request(ws, data.room, data.current_temperature, data.target_temperature, data.wind);
                RM.newRequest(new_request); 
            }
        } catch (err) {
            logger.error(err);
        }
    });
})

myEmitter.on('MinutePassed', () => {
    RM.running();
})
