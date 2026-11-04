import path from 'path';
import os from 'os';

export const DYNAMIC_MCP_CONFIG_PATH = path.join(os.homedir(), '.jarvis', 'mcp-dynamic.json');
export const JARVIS_DATA_DIR = path.join(os.homedir(), '.jarvis');
export const GOOGLE_CREDENTIALS_DIR = path.join(JARVIS_DATA_DIR, 'google');
export const GOOGLE_CREDENTIALS_PATH = path.join(GOOGLE_CREDENTIALS_DIR, 'credentials.json');
export const LEGACY_GOOGLE_CALENDAR_CREDENTIALS_DIR = path.join(JARVIS_DATA_DIR, 'google-calendar');
export const LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH = path.join(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_DIR, 'credentials.json');
export const GOOGLE_CALENDAR_CREDENTIALS_DIR = GOOGLE_CREDENTIALS_DIR;
export const GOOGLE_CALENDAR_CREDENTIALS_PATH = GOOGLE_CREDENTIALS_PATH;
export const GOOGLE_CALENDAR_SERVER_NAME = 'google-calendar';
export const GOOGLE_CALENDAR_TOKEN_PATH = path.join(JARVIS_DATA_DIR, 'google-calendar-mcp', 'tokens.json');
