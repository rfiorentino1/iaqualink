export declare const AQUALINK_API_KEY = "EOOEMOW4YR6QNB07";
export declare const LOGIN_URL = "https://prod.zodiac-io.com/users/v1/login";
export declare const REFRESH_URL = "https://prod.zodiac-io.com/users/v1/refresh";
export declare const DEVICES_URL = "https://r-api.iaqualink.net/devices.json";
export declare const SESSION_URL = "https://r-api.iaqualink.net/v2/mobile/session.json";
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
export declare class IAqualinkApiClient {
    private readonly username;
    private readonly password;
    private readonly http;
    private authToken;
    private userId;
    private idToken;
    private refreshToken;
    constructor(username: string, password: string);
    login(): Promise<void>;
    refreshAuth(): Promise<void>;
    getDevices(): Promise<IAqualinkDevice[]>;
    private sessionHeaders;
    sendCommand(serial: string, command: string, extra?: Record<string, string>): Promise<unknown>;
    getHomeScreen(serial: string): Promise<unknown>;
    getDevicesScreen(serial: string): Promise<unknown>;
    setPoolPump(serial: string): Promise<unknown>;
    setSpaPump(serial: string): Promise<unknown>;
    setPoolHeater(serial: string): Promise<unknown>;
    setSpaHeater(serial: string): Promise<unknown>;
    setAux(serial: string, auxNumber: string): Promise<unknown>;
    setLight(serial: string, aux: string, light: string, subtype?: string): Promise<unknown>;
    setTemps(serial: string, temps: Record<string, string>): Promise<unknown>;
    get isLoggedIn(): boolean;
}
