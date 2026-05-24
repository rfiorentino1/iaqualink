import axios, { AxiosError, AxiosInstance } from 'axios';

export const AQUALINK_API_KEY = 'EOOEMOW4YR6QNB07';
export const LOGIN_URL = 'https://prod.zodiac-io.com/users/v1/login';
export const REFRESH_URL = 'https://prod.zodiac-io.com/users/v1/refresh';
export const DEVICES_URL = 'https://r-api.iaqualink.net/devices.json';
export const SESSION_URL = 'https://r-api.iaqualink.net/v2/mobile/session.json';

export interface IAqualinkDevice {
  serial_number: string;
  device_type: string;
  name: string;
}

export interface IDeviceState {
  name: string;
  state: string;
  label?: string;
  type?: string;
  subtype?: string;
  aux?: string;
}

export class IAqualinkApiClient {
  private readonly http: AxiosInstance;
  private authToken = '';
  private userId = '';
  private sessionId = '';
  private idToken = '';
  private refreshToken = '';

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {
    this.http = axios.create({
      headers: {
        'user-agent': 'okhttp/3.14.7',
        'content-type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async login(): Promise<void> {
    const resp = await this.http.post(LOGIN_URL, {
      api_key: AQUALINK_API_KEY,
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

  async refreshAuth(): Promise<void> {
    try {
      const resp = await this.http.post(REFRESH_URL, {
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
    } catch {
      // Refresh failed — fall back to full login
      await this.login();
    }
  }

  async getDevices(): Promise<IAqualinkDevice[]> {
    const resp = await this.http.get(DEVICES_URL, {
      params: {
        api_key: AQUALINK_API_KEY,
        authentication_token: this.authToken,
        user_id: this.userId,
      },
    });
    return resp.data as IAqualinkDevice[];
  }

  private sessionHeaders() {
    return {
      Authorization: `Bearer ${this.idToken}`,
      api_key: AQUALINK_API_KEY,
    };
  }

  async sendCommand(serial: string, command: string, extra: Record<string, string> = {}): Promise<unknown> {
    const buildUrl = () => {
      const params: Record<string, string> = {
        actionID: 'command',
        command,
        serial,
        sessionID: this.sessionId,
        ...extra,
      };
      const queryStr = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      return `${SESSION_URL}?${queryStr}`;
    };

    try {
      const resp = await this.http.get(buildUrl(), { headers: this.sessionHeaders() });
      return resp.data;
    } catch (err) {
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

  async getHomeScreen(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'get_home');
  }

  async getDevicesScreen(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'get_devices');
  }

  async setPoolPump(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'set_pool_pump');
  }

  async setSpaPump(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'set_spa_pump');
  }

  async setPoolHeater(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'set_pool_heater');
  }

  async setSpaHeater(serial: string): Promise<unknown> {
    return this.sendCommand(serial, 'set_spa_heater');
  }

  async setAux(serial: string, auxNumber: string): Promise<unknown> {
    return this.sendCommand(serial, `set_aux_${auxNumber}`);
  }

  async setLight(serial: string, aux: string, light: string, subtype?: string): Promise<unknown> {
    const extra: Record<string, string> = { aux, light };
    if (subtype !== undefined) {
      extra['subtype'] = subtype;
    }
    return this.sendCommand(serial, 'set_light', extra);
  }

  async setTemps(serial: string, temps: Record<string, string>): Promise<unknown> {
    return this.sendCommand(serial, 'set_temps', temps);
  }

  get isLoggedIn(): boolean {
    return this.authToken !== '';
  }
}

function isLikelySessionInvalidation(err: unknown): boolean {
  const ax = err as AxiosError | undefined;
  const status = ax?.response?.status;
  return status !== undefined && (status === 401 || status === 403 || (status >= 500 && status < 600));
}
