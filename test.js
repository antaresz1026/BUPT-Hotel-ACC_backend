const PriorityQueue = require('js-priority-queue');

const waiting_queue = new PriorityQueue({
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

const data1 = {
    roomid: 1,
    priority: 3,
    serviceTime: 5,
    waitingTime: 0 
}

const data2 = {
    roomid: 2,
    priority: 2,
    serviceTime: 0,
    waitingTime: 0
}

const data3 = {
    roomid: 3,
    priority: 2,
    serviceTime: 3,
    waitingTime: 1
}

const data4 = {
    roomid: 4,
    priority: 2,
    serviceTime: 4,
    waitingTime: 0
}

const data5 = {
    roomid: 5,
    priority: 3,
    serviceTime: 4,
    waitingTime: 0
}

waiting_queue.queue(data1);

waiting_queue.queue(data2);
waiting_queue.queue(data3);
waiting_queue.queue(data4);
waiting_queue.queue(data5);

function printQueue() {
    if (waiting_queue.length > 0) {
        const template = new Set();
        let print_str = "Waiting: ";
        const circle_time = waiting_queue.length;

        for(let i = circle_time; i > 0;i -- ) {
            let temp = waiting_queue.dequeue();
            template.add(temp);
            if (i !== 1) {
                print_str += `Room[${temp.roomid}](${temp.waitingTime}) -> `;
            } else {
                print_str += `Room[${temp.roomid}](${temp.waitingTime})`;
            }
        }
        template.forEach((request) => {
            waiting_queue.queue(request)
        })
        console.log(print_str);
    }
};

printQueue()