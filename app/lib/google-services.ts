export type GoogleServiceId = 'calendar' | 'gmail';

export interface GoogleScope {
  label: string;
  value: string;
}

export interface GoogleServiceRuntimeConfig {
  credentialEnvVar: string;
  tokenFileName: string;
  tokenSubdir?: string;
  tokenPathEnvVar?: string;
  xdgConfigHome?: boolean;
  stateDirName?: string;
  stateDirEnvVar?: string;
  attachmentDirEnvVar?: string;
  downloadDirEnvVar?: string;
}

export interface GoogleServiceDefinition {
  id: GoogleServiceId;
  serverName: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  apiName: string;
  apiUrl: string;
  cloudSearchUrl: string;
  packageName: string;
  command: string;
  args: string[];
  authArgs: string[];
  authScopeArg?: string;
  startBeforeAuth: boolean;
  scopes: GoogleScope[];
  setupNotes: string[];
  runtime: GoogleServiceRuntimeConfig;
}

export const GOOGLE_SERVICES: GoogleServiceDefinition[] = [
  {
    id: 'calendar',
    serverName: 'google-calendar',
    label: 'Google Calendar',
    shortLabel: 'Calendar',
    description: 'Read, create, update, and delete calendar events.',
    icon: 'CAL',
    apiName: 'Google Calendar API',
    apiUrl: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    cloudSearchUrl: 'https://console.cloud.google.com/apis/library?filter=category:productivity&q=calendar',
    packageName: '@cocal/google-calendar-mcp',
    command: 'npx',
    args: ['-y', '@cocal/google-calendar-mcp'],
    authArgs: ['-y', '@cocal/google-calendar-mcp', 'auth'],
    startBeforeAuth: true,
    scopes: [
      {
        label: 'Calendar read/write',
        value: 'https://www.googleapis.com/auth/calendar',
      },
    ],
    setupNotes: [
      'Enable Google Calendar API.',
      'OAuth client type must be Desktop app.',
    ],
    runtime: {
      credentialEnvVar: 'GOOGLE_OAUTH_CREDENTIALS',
      tokenSubdir: 'google-calendar-mcp',
      tokenFileName: 'tokens.json',
      xdgConfigHome: true,
    },
  },
  {
    id: 'gmail',
    serverName: 'gmail',
    label: 'Gmail',
    shortLabel: 'Gmail',
    description: 'Read, search, label, draft, and send Gmail messages.',
    icon: 'GML',
    apiName: 'Gmail API',
    apiUrl: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
    cloudSearchUrl: 'https://console.cloud.google.com/apis/library?filter=category:productivity&q=gmail',
    packageName: '@gongrzhe/server-gmail-autoauth-mcp',
    command: 'npx',
    args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    authArgs: ['-y', '@gongrzhe/server-gmail-autoauth-mcp', 'auth'],
    startBeforeAuth: false,
    scopes: [
      {
        label: 'Read messages and labels',
        value: 'https://www.googleapis.com/auth/gmail.readonly',
      },
      {
        label: 'Modify messages and labels',
        value: 'https://www.googleapis.com/auth/gmail.modify',
      },
      {
        label: 'Create drafts',
        value: 'https://www.googleapis.com/auth/gmail.compose',
      },
      {
        label: 'Send messages',
        value: 'https://www.googleapis.com/auth/gmail.send',
      },
      {
        label: 'Manage labels',
        value: 'https://www.googleapis.com/auth/gmail.labels',
      },
    ],
    setupNotes: [
      'Enable Gmail API.',
      'OAuth client type must be Desktop app.',
    ],
    runtime: {
      credentialEnvVar: 'GOOGLE_OAUTH_CREDENTIALS',
      tokenSubdir: 'gmail-mcp',
      tokenFileName: 'tokens.json',
      xdgConfigHome: true,
    },
  },
];

export function getGoogleService(id: string): GoogleServiceDefinition | undefined {
  return GOOGLE_SERVICES.find((service) => service.id === id);
}

export function getGoogleServiceByServerName(serverName: string): GoogleServiceDefinition | undefined {
  return GOOGLE_SERVICES.find((service) => service.serverName === serverName);
}

export function getGoogleServiceIds(ids: string[]): GoogleServiceId[] {
  const valid = new Set(GOOGLE_SERVICES.map((service) => service.id));
  return ids.filter((id): id is GoogleServiceId => valid.has(id as GoogleServiceId));
}

export function getScopeText(serviceIds: GoogleServiceId[]): string {
  const scopes = new Map<string, GoogleScope>();
  for (const id of serviceIds) {
    const service = getGoogleService(id);
    for (const scope of service?.scopes ?? []) {
      scopes.set(scope.value, scope);
    }
  }
  return [...scopes.values()].map((scope) => scope.value).join('\n');
}
