"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IAqualinkApiClient = exports.SESSION_URL = exports.DEVICES_URL = exports.REFRESH_URL = exports.LOGIN_URL = exports.AQUALINK_API_KEY = void 0;
const axios_1 = __importDefault(require("axios"));
exports.AQUALINK_API_KEY = 'EOOEMOW4YR6QNB07';
exports.LOGIN_URL = 'https://prod.zodiac-io.com/users/v1/login';
exports.REFRESH_URL = 'https://prod.zodiac-io.com/users/v1/refresh';
exports.DEVICES_URL = 'https://r-api.iaqualink.net/devices.json';
exports.SESSION_URL = 'https://r-api.iaqualink.net/v2/mobile/session.json';
class IAqualinkApiClient {
    username;
    password;
    http;
    authToken = '';
    userId = '';
    sessionId = '';
    idToken = '';
    refreshToken = '';
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.http = axios_1.default.create({
            headers: {
                'user-agent': 'okhttp/3.14.7',
                'content-type': 'application/json',
            },
            timeout: 15000,
        });
    }
    async login() {
        const resp = await this.http.post(exports.LOGIN_URL, {
            api_key: exports.AQUALINK_API_KEY,
            email: this.username,
            password: this.password,
        });
        const data = resp.data;
        this.authToken = data.authentication_token;
        this.userId = String(data.id);
        this.sessionId = data.session_id;
        this.idToken = data.userPoolOAuth?.IdToken ?? '';
        this.refreshToken = data.userPoolOAuth?.RefreshToken ?? '';
    }
    async refreshAuth() {
        try {
            const resp = await this.http.post(exports.REFRESH_URL, {
                email: this.username,
                refresh_token: this.refreshToken,
            });
            const data = resp.data;
            this.authToken = data.authentication_token;
            this.userId = String(data.id);
            this.sessionId = data.session_id;
            this.idToken = data.userPoolOAuth?.IdToken ?? this.idToken;
            if (data.userPoolOAuth?.RefreshToken) {
                this.refreshToken = data.userPoolOAuth.RefreshToken;
            }
        }
        catch {
            // Refresh failed — fall back to full login
            await this.login();
        }
    }
    async getDevices() {
        const resp = await this.http.get(exports.DEVICES_URL, {
            params: {
                api_key: exports.AQUALINK_API_KEY,
                authentication_token: this.authToken,
                user_id: this.userId,
            },
        });
        return resp.data;
    }
    sessionHeaders() {
        return {
            Authorization: `Bearer ${this.idToken}`,
            api_key: exports.AQUALINK_API_KEY,
        };
    }
    async sendCommand(serial, command, extra = {}) {
        const buildUrl = () => {
            const params = {
                actionID: 'command',
                command,
                serial,
                sessionID: this.sessionId,
                ...extra,
            };
            const queryStr = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
            return `${exports.SESSION_URL}?${queryStr}`;
        };
        try {
            const resp = await this.http.get(buildUrl(), { headers: this.sessionHeaders() });
            return resp.data;
        }
        catch (err) {
            // Jandy's session.json invalidates a sessionID whenever a fresh login is
            // performed against the same account (e.g. the iAquaLink mobile app being
            // opened). The displaced session then returns 5xx — sometimes 500, sometimes
            // 401/403 — until we re-login. Refresh and retry once; if it still fails,
            // let the caller see the original-class error.
            if (!isLikelySessionInvalidation(err)) {
                throw err;
            }
            await this.refreshAuth();
            const resp = await this.http.get(buildUrl(), { headers: this.sessionHeaders() });
            return resp.data;
        }
    }
    async getHomeScreen(serial) {
        return this.sendCommand(serial, 'get_home');
    }
    async getDevicesScreen(serial) {
        return this.sendCommand(serial, 'get_devices');
    }
    async setPoolPump(serial) {
        return this.sendCommand(serial, 'set_pool_pump');
    }
    async setSpaPump(serial) {
        return this.sendCommand(serial, 'set_spa_pump');
    }
    async setPoolHeater(serial) {
        return this.sendCommand(serial, 'set_pool_heater');
    }
    async setSpaHeater(serial) {
        return this.sendCommand(serial, 'set_spa_heater');
    }
    async setAux(serial, auxNumber) {
        return this.sendCommand(serial, `set_aux_${auxNumber}`);
    }
    async setLight(serial, aux, light, subtype) {
        const extra = { aux, light };
        if (subtype !== undefined) {
            extra['subtype'] = subtype;
        }
        return this.sendCommand(serial, 'set_light', extra);
    }
    async setTemps(serial, temps) {
        return this.sendCommand(serial, 'set_temps', temps);
    }
    get isLoggedIn() {
        return this.authToken !== '';
    }
}
exports.IAqualinkApiClient = IAqualinkApiClient;
function isLikelySessionInvalidation(err) {
    const ax = err;
    const status = ax?.response?.status;
    return status !== undefined && (status === 401 || status === 403 || (status >= 500 && status < 600));
}
