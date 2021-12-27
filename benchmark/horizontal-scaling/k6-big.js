import { Trend } from 'k6/metrics';
import ws from 'k6/ws';

/**
 * You need to run 4 terminals for this.
 *
 * 1. Run the servers:
 *
 * PORT=6001 ADAPTER_DRIVER=cluster RATE_LIMITER_DRIVER=cluster bin/server.js start
 * PORT=6002 ADAPTER_DRIVER=cluster RATE_LIMITER_DRIVER=cluster bin/server.js start
 *
 * 2. Run the PHP senders based on the amount of messages per second you want to receive.
 *    The sending rate influences the final benchmark.
 *
 * Low, 1 message per second:
 * php send --interval 1 --port 6001
 * php send --interval 1 --port 6002
 *
 * Mild, 2 messages per second:
 * php send --interval 0.5 --port 6001
 * php send --interval 0.5 --port 6002
 *
 * Overkill, 10 messages per second:
 * php send --interval 0.1 --port 6001
 * php send --interval 0.1 --port 6002
 */

const delayTrend = new Trend('message_delay_ms');

export const options = {
    // K6 options
    scenarios: {
        // Keep connected many users users at the same time.
        soakTraffic1: {
            executor: 'per-vu-iterations',
            vus: 500,
            iterations: 6,
            env: {
                sleep: '10',
                host: __ENV.WS_URL1 || 'ws://127.0.0.1:6001/app/app-key',
            },
        },
        soakTraffic2: {
            executor: 'per-vu-iterations',
            vus: 500,
            iterations: 6,
            env: {
                sleep: '10',
                host: __ENV.WS_URL2 || 'ws://127.0.0.1:6002/app/app-key',
            },
        },

        // Having high amount of connections and disconnections
        // representing active traffic that starts after 5 seconds
        // from the soakTraffic scenario.
        highTraffic1: {
            executor: 'ramping-vus',
            startVUs: 0,
            startTime: '5s',
            stages: [
                { duration: '30s', target: 500 },
                { duration: '10s', target: 500 },
                { duration: '10s', target: 250 },
                { duration: '10s', target: 100 },
                { duration: '10s', target: 250 },
            ],
            gracefulRampDown: '5s',
            env: {
                sleep: '5',
                host: __ENV.WS_URL1 || 'ws://127.0.0.1:6001/app/app-key',
            },
        },
        highTraffic2: {
            executor: 'ramping-vus',
            startVUs: 0,
            startTime: '5s',
            stages: [
                { duration: '30s', target: 500 },
                { duration: '10s', target: 500 },
                { duration: '10s', target: 250 },
                { duration: '10s', target: 100 },
                { duration: '10s', target: 250 },
            ],
            gracefulRampDown: '5s',
            env: {
                sleep: '5',
                host: __ENV.WS_URL2 || 'ws://127.0.0.1:6002/app/app-key',
            },
        },
    },
};

export default () => {
    ws.connect(__ENV.host, null, (socket) => {
        socket.setTimeout(() => {
            socket.close();
        }, __ENV.sleep * 1000);

        socket.on('open', () => {
            // Keep connection alive with pusher:ping
            socket.setInterval(() => {
                socket.send(JSON.stringify({
                    event: 'pusher:ping',
                    data: JSON.stringify({}),
                }));
            }, 30000);

            socket.on('message', message => {
                let receivedTime = Date.now();

                message = JSON.parse(message);

                if (message.event === 'pusher:connection_established') {
                    socket.send(JSON.stringify({
                        event: 'pusher:subscribe',
                        data: { channel: 'benchmark' },
                    }));
                }

                if (message.event === 'timed-message') {
                    let data = JSON.parse(message.data);

                    delayTrend.add(receivedTime - data.time);
                }
            });
        });
    });
}