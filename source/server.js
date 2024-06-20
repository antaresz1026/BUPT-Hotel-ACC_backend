const express = require('express');
const WebSocket = require('ws');
const https = require('https');
const winston = require('winston');
const fs = require('fs');
const mysql = require('mysql2/promise');
const PriorityQueue = require('js-priority-queue');
const EventEmitter = require('events');
const e = require('express');

class MyEmitter extends EventEmitter {}


/**
 * on: AC open
 * waiting: wait for schedule
 * working
 * rest: reach target temperature
 * off: AC close
 * @author antaresz
 *
 * @class Room
 * @typedef {Room}
 */
class Room {
    constructor(AC_status, temperature, enviroment) {
        this.AC_status = AC_status;
        this.temperature = temperature;
        this.enviroment = enviroment;
        this.wind = 0;
    }
}

class Request {
    constructor(socketid, roomid, current_temperature, target_temperature, priority) {
      this.socketid = socketid;
      this.roomid = roomid;
      this.current_temperature = current_temperature;
      this.target_temperature = target_temperature;
      this.priority = priority;
      this.serviceTime = 0;
      this.waitingTime = 0;
    }
}

class Detail {
    constructor(roomid, request_time) {
        this.roomid = roomid;
        this.request_time = request_time;
        this.serve_start = 0;
        this.serve_end = 0;
        this.serve_time = 0;
        this.wind = 0;
        this.sum = 0;
        this.ratio = 0
    }
}

class Bill {
    constructor(roomid, check_in) {
        this.roomid = roomid;
        this.check_in = check_in;
        this.check_out = 0;
        this.sum = 0;
    }
}

class Rooms {
    constructor(account_manager) {
        this.rooms = new Map();
        this.room_table = new Set();
        this.account_manager = account_manager;
    }

    addRoom(roomid, roomState) {
        this.rooms.set(roomid, roomState);
        this.account_manager.addBill(new Bill(roomid, simulatedTime));
    }
    
    /**
     * update status of room, only AC_status and temperature, because enviroment can't be reset.
     * working to waiting , commit old, new detail
     * working to working , if wind not change ,leave it out, else commit old, new detail
     * on to waiting, new detail
     * waiting to working, if exist detail , add serve_start, else add request_time, serve_start
     * working to rest , 
     * @author antaresz
     *
     * @param {*} whichstatus
     * @param {*} roomid
     * @param {*} value
     */
    updateRoom(whichstatus, roomid, value) {
        if(!this.rooms.has(roomid)) {
            const m_err = new Error('Target Room isn\'t existed.');
            throw m_err;
        } else {
            let exist_detail = this.account_manager.findDetail(roomid);
            let status_now = this.getRoomStatus('AC_status', roomid);

            if (whichstatus === 'AC_status'){
                if (exist_detail) {
                    if (value === 'waiting') {
                        if (status_now === 'working') {
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from working to waiting [commit]`)
                            exist_detail.serve_end = simulatedTime - 1;
                            exist_detail.serve_time = exist_detail.serve_end - exist_detail.serve_start;
                            exist_detail.wind = this.rooms.get(roomid).wind;
                            if (exist_detail.wind === 1) {
                                exist_detail.ratio = 0.33;
                            } else if (exist_detail.wind === 2) {
                                exist_detail.ratio = 0.5;
                            } else if (value === 3) {
                                exist_detail.ratio = 1;
                            }
                            exist_detail.sum = exist_detail.serve_time * exist_detail.ratio;
                            this.account_manager.commitToSQL(exist_detail);
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from on to waiting [new]`)
                            let new_detail = new Detail(roomid, simulatedTime);
                            this.account_manager.details.add(new_detail);
                        }
                    } else if (value === 'working') {
                        if (status_now === 'waiting') {
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from waiting to working [change]`)
                            exist_detail.serve_start = simulatedTime - 1;
                        }
                    } else if (value === 'off') {
                        if (status_now === 'working') {
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from working to off [commmit]`)
                            exist_detail.serve_end = simulatedTime - 1;
                            exist_detail.serve_time = exist_detail.serve_end - exist_detail.serve_start;
                            exist_detail.wind = this.rooms.get(roomid).wind;
                            if (exist_detail.wind === 1) {
                                exist_detail.ratio = 0.33;
                            } else if (exist_detail.wind === 2) {
                                exist_detail.ratio = 0.5;
                            } else if (value === 3) {
                                exist_detail.ratio = 1;
                            }
                            exist_detail.sum = exist_detail.serve_time * exist_detail.ratio;
                            this.account_manager.commitToSQL(exist_detail);
                        } else if (status_now === 'waiting') {
                            this.account_manager.details.delete(exist_detail);
                        }
                    }
                } else {
                    if (value === 'waiting') {
                        if (status_now === 'on') {
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from on to waiting [new]`)
                            let new_detail = new Detail(roomid, simulatedTime - 1);
                            this.account_manager.details.add(new_detail);
                        }
                    } else if (value === 'working') {
                        if (status_now === 'waiting') {
                            logger.warn(`Time: ${simulatedTime} Room[${roomid}] from waiting to working [new]`)
                            let new_detail = new Detail(roomid, simulatedTime - 1)
                            new_detail.serve_start = simulatedTime - 1;
                            this.account_manager.details.add(new_detail);
                        }
                    }
                }
                this.rooms.get(roomid).AC_status = value;
            } else if (whichstatus === 'temperature') {
                this.rooms.get(roomid).temperature = value;
            } else if (whichstatus === 'wind') {
                if (this.rooms.get(roomid).wind !== value && this.rooms.get(roomid).wind !== 0) {
                    logger.warn(`Time: ${simulatedTime} Room[${roomid}] Try to change wind from ${this.rooms.get(roomid).wind} to ${value} [commit]`)
                    exist_detail.serve_end = simulatedTime - 1;
                    exist_detail.serve_time = exist_detail.serve_end - exist_detail.serve_start;
                    exist_detail.wind = this.rooms.get(roomid).wind;
                    if (exist_detail.wind === 1) {
                        exist_detail.ratio = 0.33;
                    } else if (exist_detail.wind === 2) {
                        exist_detail.ratio = 0.5;
                    } else if (value === 3) {
                        exist_detail.ratio = 1;
                    }
                    exist_detail.sum = exist_detail.serve_time * exist_detail.ratio;
                    this.account_manager.commitToSQL(exist_detail);
                } else {
                    exist_detail.wind = value;
                    if (exist_detail.wind === 1) {
                        exist_detail.ratio = 0.33;
                    } else if (exist_detail.wind === 2) {
                        exist_detail.ratio = 0.5;
                    } else if (exist_detail.wind === 3) {
                        exist_detail.ratio = 1;
                    }
                }
                logger.warn(`Time: ${simulatedTime} Room[${roomid}] Try to change wind from ${this.rooms.get(roomid).wind} to ${value} [set]`)
                this.rooms.get(roomid).wind = value;
            }
        }
    }

    
    /**
     * return a room's status
     * @author antaresz
     *
     * @param {*} whichstatus
     * @param {*} roomid
     * @returns {*}
     */
    getRoomStatus(whichstatus, roomid) {
        let result;
        if(whichstatus === 'AC_status') {
            result = this.rooms.get(roomid).AC_status;
        } else if (whichstatus === 'temperature') {
            result = this.rooms.get(roomid).temperature;
        } 

        return result;
    }

    allRoomsStatus() {
        let result = {};

        this.rooms.forEach((value, key) => {
            result[key] = value;
        })

        return result;
    }

}



class Service {
    constructor(rooms, mode, maxServingRequests) {
        this.rooms = rooms;
        this.mode = mode;
        this.maxServingRequests = maxServingRequests;
    }

    Serve(request) {
        //just for console
        const __temperature = request.current_temperature;
        
        if (mode === 'cold') {
            request.current_temperature -= 0.5;
        } else {
            request.current_temperature += 0.5;
        }

        request.serviceTime += 1;
        request.waitingTime = 0;
        this.rooms.updateRoom('temperature', request.roomid, request.current_temperature);
        logger.info(`Serving Room${request.roomid}(${__temperature} -> ${request.current_temperature})`);
    }
}

  
class Scheduler {
    constructor(rooms, service) {
        this.rooms = rooms;
        this.resource = service
        this.requests = new Set();
        this.waiting_queue = new PriorityQueue({
            comparator: (a, b) => {
                if (b.priority === a.priority) {
                    if (b.waitingTime === this.WAITING_LONG && a.waitingTime !== this.WAITING_LONG) {
                        return 1;
                    } else if (a.waitingTime === this.WAITING_LONG && b.waitingTime !== this.WAITING_LONG) {
                        return -1;
                    } else if (b.waitingTime === a.waitingTime) {
                        return a.serviceTime - b.serviceTime;
                    } else {
                        return b.waitingTime - a.waitingTime;
                    }
                }
                return b.priority - a.priority;
            }
        });
        
        this.resting_queue = new Set();
        this.WAITING_LONG = 2;
    }

    running() {
        const template = new Set();
        const ready_queue = new Set();
        //when ready_queue.size == 0 it entry
        logger.debug("Requests:");
        this.requests.forEach(request => {
            logger.debug(`Room[${request.roomid}](${this.rooms.getRoomStatus('AC_status', request.roomid)}): ${request.target_temperature}----------------(temperature: ${request.current_temperature} wind: ${request.priority} serviceTime: ${request.serviceTime} waitingTime: ${request.waitingTime}) `);
        }); 
        logger.debug("Queue:");
        this.printQueue("Waiting: ");
        while(ready_queue.size < this.resource.maxServingRequests && this.waiting_queue.length > 0) {
            let ready_request =  this.waiting_queue.dequeue();
            ready_queue.add(ready_request);
            template.add(ready_request);
            //waiting to working
            this.rooms.updateRoom('AC_status', ready_request.roomid, 'working')

        }
        while(this.waiting_queue.length > 0) {
            let restof_request = this.waiting_queue.dequeue();
            if(restof_request.waitingTime !== 2) {
                restof_request.waitingTime += 1;
            }
            template.add(restof_request);
            //working to waiting
            this.rooms.updateRoom('AC_status', restof_request.roomid, 'waiting');
        }
        ready_queue.forEach((serve_request) => {
            this.resource.Serve(serve_request);
            this.reachCheck(serve_request);
        })
        template.forEach((all_request) => {
            this.waiting_queue.queue(all_request);
        })
    }

    addRequest(new_request) {
        let existing_request = null;

        this.requests.forEach(request => {
            if (request.roomid === new_request.roomid) {
                existing_request = request;
            }
        });

        if (existing_request) {
            existing_request.target_temperature = new_request.target_temperature;
            existing_request.current_temperature = new_request.current_temperature;
            existing_request.priority = new_request.priority;
            logger.debug(`Request[${new_request.roomid}] already exists. data update now.`);
            const template = new Set();

            while (this.waiting_queue.length > 0) {
                let update_request = this.waiting_queue.dequeue();
                template.add(update_request);
            }
            template.forEach((update_request) => {
                this.waiting_queue.queue(update_request);
            })
        } else {
            this.requests.add(new_request);
            //on to waiting
            this.rooms.updateRoom('AC_status', new_request.roomid, 'waiting');
            this.waiting_queue.queue(new_request);
        }
        
    }

    reachCheck(release_request) {
        if (Math.abs(release_request.current_temperature - release_request.target_temperature) < 0.1) {
            this.deleteRequest(release_request)
            this.resting_queue.add(release_request)
            //working to rest
            this.rooms.updateRoom('AC_status', release_request.roomid, 'rest')
            this.rooms.updateRoom('wind', release_request, 0);
        }
    }

    deleteRequest(delete_request) {
        if (this.waiting_queue.length > 0) {
            const template = new Set();
            const circle_time = this.waiting_queue.length;

            for(let i = circle_time; i > 0;i -- ) {
                let temp = this.waiting_queue.dequeue();
                if (temp.roomid !== delete_request.roomid) {
                    template.add(temp);
                }
            }
            template.forEach((request) => {
                this.waiting_queue.queue(request)
            })
        }
        this.requests.delete(delete_request)
    }

    printQueue(head) {
        if (this.waiting_queue.length > 0) {
            const template = new Set();
            let print_str = head;
            const circle_time = this.waiting_queue.length;

            for(let i = circle_time; i > 0;i -- ) {
                let temp = this.waiting_queue.dequeue();
                template.add(temp);
                if (i !== 1) {
                    print_str += `Room[${temp.roomid}](${temp.waitingTime}) -> `;
                } else {
                    print_str += `Room[${temp.roomid}](${temp.waitingTime})`;
                }
            }
            template.forEach((request) => {
                this.waiting_queue.queue(request)
            })
            logger.info(print_str)
        }
    }

    findRequest(roomid) {
        let result;

        this.requests.forEach((search_request) => {
            if (search_request.roomid === roomid) {
                result = search_request;
            }
        })

        return result;
    }
}

class Account {
    constructor(sql_manager) {
        this.sql_manager = sql_manager;
        this.details = new Set();
        this.undone_details = new Set();
        this.bills = new Set();
    }

    addDetail(new_detail) {
        let existing_detail = this.findDetail(new_detail);

        if (existing_detail) {
            this.commitToSQL(existing_detail);
        } else {
            logger.debug(`(Time: ${simulatedTime}) ----------------------- Add detail of Room[${new_detail.roomid}] with wind--${new_detail.wind}`)
            this.details.add(new_detail);
        }
    }

    commitToSQL(detail) {
        this.details.delete(detail);
        if (detail.serve_time !== 0) {
            this.sql_manager.query('INSERT INTO DETAILS (roomid, request_time, working_start, working_end, serving_time, wind, details, ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [detail.roomid, detail.request_time, detail.serve_start, detail.serve_end, detail.serve_time, detail.wind, detail.sum, detail.ratio]
            )
        }
        
    }

    addBill(bill) {
        this.bills.add(bill);
    }

    findDetail(roomid) {
        let existing_detail = null;

        this.details.forEach((detail) => {
            if (detail.roomid === roomid) {
                existing_detail = detail;
            }
        });

        return existing_detail;
    }
}


class Clients {
    constructor(rooms, scheduler, account_manager) {
        this.rooms = rooms;
        this.scheduler = scheduler;
        this.account_manager = account_manager;
        this.clients = new Set();
        this.admins = new Set();
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
            //当前时间
            logger.debug(`ServerTime: ${simulatedTime}`);
            
            this.broadCast(this.admins, JSON.stringify({ type: 'MINUTE_PASSED', time: simulatedTime}));
            this.scheduler.running();
            let allroomstatus = this.rooms.allRoomsStatus();
            //房间状态
            logger.debug("Rooms:");
            for (const key in allroomstatus) {
                const value = allroomstatus[key];
                logger.debug(`Room[${key}](${value.AC_status}): ${value.temperature} now.`);
                this.rooms.room_table.add({ room: key, temperature: value.temperature, AC_status: value.AC_status});
            }
            this.scheduler.requests.forEach(request => {
                request.socketid.send(JSON.stringify({type: 'TEMPERATURE_UPDATE', data: this.rooms.getRoomStatus('temperature', request.roomid)}));
            });
            simulatedTime += 1;
            this.broadCast(this.clients, JSON.stringify({ type: 'MINUTE_PASSED', time: simulatedTime}));
            
            const room_table = Array.from(this.rooms.room_table);
            this.broadCast(this.admins, JSON.stringify({ type: 'ROOMS_TABLE', data: room_table}));
            this.rooms.room_table.clear();
            logger.warn("---------------------------------------------")
        }, 10000);
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

    sendResponse(ws, callback, replyto, message) {
        ws.send(JSON.stringify({ type: 'RESPONSE', callback: `${callback}`, func: `${replyto}`, message: `${message}`}));
    }
}

class Database {
    constructor() {
        this.pool = mysql.createPool({
            connectionLimit: 10, 
            host: 'localhost',
            user: 'antaresz',
            database: 'HACC',
            password: 'antaresz.cc',
            waitForConnections: true
        });
    }

    async query(sql, params) {
        let connection;

        try {
            connection = await this.pool.getConnection();
            const [rows, fields] = await connection.execute(sql, params);

            logger.info("SQL query execute successfully.");
            return rows;
        } catch (err) {
            logger.error(`SQL query fail: ${err}`);
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }

}

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
const port = 42133;
const app = express();
const https_options = {
	key: fs.readFileSync('/home/antaresz/Projects/GPOS/Cert/privkey.pem'),
	cert: fs.readFileSync('/home/antaresz/Projects/GPOS/Cert/fullchain.pem')
};
let mode = 'cold';
let simulatedTime = 0;
const sql_manager = new Database();
const account_manager = new Account(sql_manager);
const rooms_manager = new Rooms(account_manager);
const service = new Service(rooms_manager, mode, 3);
const scheduler = new Scheduler(rooms_manager, service);
const clients_manager = new Clients(rooms_manager, scheduler, account_manager);

const server = https.createServer(https_options, app).listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    clients_manager.tickAway();
});
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    logger.info('Client connected');
    ws.on('message', async (msg) => {

        try {
            const data = JSON.parse(msg);
            logger.info(`Client send a ${data.type} message.`);
            if (data.type === 'LOGIN') {
                if (data.role === 'user') {
                    let ifexist = await sql_manager.query('SELECT * FROM USERS WHERE roomid = ?', [data.form.room]);
                    if (ifexist.length > 0) {
                        const m_err = new Error(`${data.form.room} already exists.`)
                        throw m_err; //throw out to send to client error
                    } else {
                        // sql_manager.query('INSERT INTO USERS (name, roomid) VALUES (?, ?)', [data.form.name, data.form.room]);
                        logger.info(`User in Room[${data.form.room}] loged in`);
                        const room = new Room(data.room_status.AC_status, data.room_status.temperature, data.room_status.enviroment);
                        const new_bill = new Bill(data.room, simulatedTime);
                        account_manager.addBill(new_bill);
                        rooms_manager.addRoom(data.form.room, room);
                    }
                    clients_manager.addClient(ws, data.role);
                } else if (data.role === 'admin') {
                    logger.info("One admin loged in");
                    
                    //for test
                    if (clients_manager.admins.size === 0) {
                        clients_manager.addClient(ws, data.role);
                    }
                    logger.info(`User in Room[${data.form.room}] loged in`);
                    const room = new Room(data.room_status.AC_status, data.room_status.temperature, data.room_status.enviroment);
                    
                    rooms_manager.addRoom(data.form.room, room);
                }
                
                clients_manager.sendResponse(ws, 'true', 'login');
            } else if (data.type === 'AC_ON') {
                logger.info(`Room[${data.roomid}] wants to turn AC on`);
                rooms_manager.updateRoom('AC_status', data.roomid, 'on');
                clients_manager.sendResponse(ws, 'true', 'AC_on');
            } else if (data.type === 'AC_OFF') {
                logger.info(`Room[${data.roomid}] wants to turn AC off`);
                
                let delete_request = scheduler.findRequest(data.roomid);
                scheduler.deleteRequest(delete_request);
                //working to off
                rooms_manager.updateRoom('AC_status', data.roomid, 'off');
                
                clients_manager.sendResponse(ws, 'true', 'AC_off');
            } else if (data.type === 'REQUEST') {
                const room_status_now = rooms_manager.getRoomStatus('AC_status', data.room);

                //ban 'off' status from frontend
                if (room_status_now !== 'rest') {
                    const new_request = new Request(ws, data.room, data.current_temperature, data.target_temperature, data.wind);

                    scheduler.addRequest(new_request); 
                    rooms_manager.updateRoom('wind', data.room, data.wind);
                    clients_manager.sendResponse(ws, 'true', 'request');
                } else {
                    const m_err = new Error(`${data.form.room} AC is off.Please turn on and try again`);
                    throw m_err; //throw out to send to client error
                }
            }
            
        } catch (err) {
            logger.error(err);
            clients_manager.sendResponse(ws, 'false', err);
        }
    });
})