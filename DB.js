const mysql = require('mysql2/promise');
const express = require('express');
const https = require('https');
const winston = require('winston');
const redis = require('redis');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = 42133;

const pool = mysql.createPool({
    connectionLimit: 10, 
    host: 'localhost',
    user: 'antaresz',
    database: 'HACC',
    password: 'antaresz.cc'
});

const redis_client = redis.createClient({
    host: 'localhost',
    port: 6379
});
redis_client.on('error', (err) => console.log('Redis Client Error', err));
redis_client.connect();

const https_options = {
    key: fs.readFileSync('/etc/nginx/cert/antaresz.cc.key'),
    cert: fs.readFileSync('/etc/nginx/cert/antaresz.cc_bundle.crt')
};

const customFormat = winston.format.printf((info) => {
    return `[${info.level}]${info.timestamp}: ${info.message}\n`; // 注意末尾的换行符
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json(),
        customFormat  // 添加自定义格式到格式组合中
    ),
    transports: [
        new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat  // 确保控制台输出也使用自定义格式
            )
        }),
        new winston.transports.File({
            filename: '/home/antaresz/Projects/HACC/log/error.log',
            level: 'error',
            format: customFormat  // 确保文件输出也使用自定义格式
        }),
        new winston.transports.File({
            filename: '/home/antaresz/Projects/HACC/log/runtime.log',
            format: customFormat  // 文件输出
        })
    ]
});



app.use(express.json());
app.post('/HACC/login', process_login);
app.post('/HACC/request', process_request);
app.post('/HACC/generate', generate_details);
https.createServer(https_options, app).listen(port, () => {
    console.log(`Service is running on port ${port}`);
});

async function process_login(req, res) {
    const query = 'INSERT INTO HACC.USER (userid, username, room) VALUES (UUID(), ?, ?)';
    const name = req.body.username;
    const room = req.body.userroom;

    logger.debug(name);
    try {
        const [results, fields] = await pool.query(query, [name, room]);

        if (results.affectedRows > 0) {
            const userid =  await getUserID(name, room);

            if (userid) {
                createSession(userid);
            }

            res.status(200).send('success login');
        } else {
            throw new Error("Insert fail.");
        }
    } catch (err) {
        logger.error(err.message);
        res.status(300).send("fail login: " + err.message);
    }
}

async function getUserID(username, userroom) {
    const query = 'SELECT userid FROM HACC.USER WHERE username = ? AND room = ?';
    const name = username;
    const room = userroom;

    try {
        const [results, fields] = await pool.query(query, [name, room]);

        if (results.length > 0) {
            return results[0].userid; 
        } else {
            throw new Error("No user found");
        }
    } catch (err) {
        logger.error(err.message);
        return null; 
    }
}

async function createSession(userid) {
    const sessionID = uuidv4();

    logger.debug('Session generated: ' + sessionID);
    await redis_client.set(sessionID, JSON.stringify({ userid: userid }), 'EX', 3600, (err) => logger.error('Redis Client set error:' + err.message));
}

async function process_request(req, res) {
    let _userid;
    const time = req.body.time;
    let _action;
    const wind = req.body.wind;

    //存疑，尚未确定温度模拟是在前端还是后端, 目前假定在前端
    const tem_now = req.body.tem_now;
    const tem_target = req.body.tem_target;

    try {
        const data = await redis_client.get(req.body.sessionID);
        if (data) {
            const json_data = JSON.parse(data);

            _userid = json_data.userid;
        } else {
            throw new Error('Can\'t get data from redis');
        }
    } catch (err) {
        logger.error(err.message);
    }


    if (req.body.action == 'on') {
        _action = 1;
    } else {
        _action = 0;
    }

    const userid = _userid;
    const action = _action;
    const query = 'INSERT INTO HACC.DETAILS (userid, time, action, wind, tem_now, tem_target) VALUES (?, ?, ?, ?, ?, ?)';

    try {
        const [results, fields] = await pool.query(query, [userid, time, action, wind, tem_now, tem_target]);

        if (results.affectedRows > 0) {
            res.status(200).send('request sucessfully processed');
        } else {
            throw new Error("Insert fail.");
        }
    } catch (err) {
        logger.error(err.message);
        res.status(300).send("process fail: " + err.message);
    }
}

async function generate_details(req, res) {
    let _userid;

    try {
        const data = await redis_client.get(req.body.sessionID);
        if (data) {
            const json_data = JSON.parse(data);

            _userid = json_data.userid;
        } else {
            throw new Error('Can\'t get data from redis');
        }
    } catch (err) {
        logger.error(err.message);
    }

    const userid = _userid;
    const query = 'SELECT * FROM HACC.DETAILS WHERE userid = ?';

    try {
        const [results, fields] = await pool.query(query, [userid]);

        if (results.length > 0) {
            res.status(200).json(results);
        } else {
            throw new Error("Generate fail.")
        }
    } catch (err) {
        logger.error(err.message);
        res.status(400).send("generate fail: " + err.message);
    }
}