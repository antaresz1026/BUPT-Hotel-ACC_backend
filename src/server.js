const mysql = require('mysql2/promise');
const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const PriorityQueue = require('js-priority-queue');
const winston = require('winston');
const { combine, printf } = winston.format;
const myFormat = printf(({ level, message}) => {
    return `[${level}]: ${message}`;
});
const pool = mysql.createPool({
    connectionLimit: 10, 
    host: 'localhost',
    user: 'antaresz',
    database: 'HACC',
    password: 'antaresz.cc'
});
const https_options = {
    key: fs.readFileSync('/etc/nginx/cert/antaresz.cc.key'),
    cert: fs.readFileSync('/etc/nginx/cert/antaresz.cc_bundle.crt')
};
const logger = winston.createLogger({
    level: 'info',
    format: combine(
      myFormat
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: '../logs/HACC.log' })
    ]
});


class serviceRequest {
  constructor(socketid, room, rightnow_temperature, target_temperature,priority ) {
    this.socketid = socketid
    this.data = room;
    this.rightnow = rightnow_temperature
    this.target = target_temperature
    this.priority = priority;
  }
}

class scheduler {
    constructor(stragegy, maxServeingRequests) {
        this.stragegy = stragegy;
        this.maxServeingRequests = maxServeingRequests;
        this.priority_queue = new PriorityQueue({ comparator: (a, b) => b.priority - a.priority });
        this.timeslice_queue = [];
        this.TIME_SLICE = 2;
        this.activeRequests = new Set();

        setInterval(() => this.schduler(), 1000);
    }

    schduler() {



        while (true) {
            if (this.stragegy == 'priority') {
                if (this.priority_queue.length > 0) {
                    const request = this.priority_queue.dequeue();

                    this.processRequest(request, 2 * Math.abs(request.target_temperature - request.rightnow_temperature));
                }
            } else if (this.stragegy == 'timeslice') {
                if (this.timeslice_queue.length > 0) {
                    const request = this.timeslice_queue.shift();

                    this.processRequest(request, this.TIME_SLICE);
                }
            }
        }
    }

    processRequest(service_request, time) {
        io.to(service_request.socketid).emit('AC_on', time);
    }

    newRequest(request) {
        if (this.stragegy == 'priortiy') {
            this.priority_queue.queue(request);
        } else if (this.stragegy == 'timeslice') {
            this.timeslice_queue.push(request);
        }
    }
}

const app = express();
const server = https.createServer(app);
const io = socketIo(server);

let scheduling_type = 'priority';
const sc = new scheduler(scheduling_type);
sc.schduler();

io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });

  socket.on('new_request', (data) => {
    const socketid = socket.id;
    const request_from = data.room;
    const rightnow = data.rightnow_temperature
    const target = data.target_temperature
    const priority = data.wind;
    const service_request = new serviceRequest(socketid, request_from, rightnow, target, priority);

    sc.newRequest(serviceRequest);
  });
});

const PORT = 42133;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
