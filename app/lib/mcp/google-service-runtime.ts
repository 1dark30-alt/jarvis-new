import fs from 'fs';
import os from 'os';
import path from 'path';
import { getGoogleService, getGoogleServiceByServerName, type GoogleServiceId } from '@/app/lib/google-services';
import {
  GOOGLE_CREDENTIALS_DIR,
  GOOGLE_CREDENTIALS_PATH,
  JARVIS_DATA_DIR,
} from './dynamic-config';

export function getGoogleTokenPath(serviceId: GoogleServiceId): string {
  const service = getGoogleService(serviceId);
  if (!service) {
    throw new Error(`Unknown Google service "${serviceId}"`);
  }

  const baseDir = service.runtime.tokenSubdir
    ? path.join(JARVIS_DATA_DIR, service.runtime.tokenSubdir)
    : GOOGLE_CREDENTIALS_DIR;

  return path.join(baseDir, service.runtime.tokenFileName);
}

export function ensureGoogleServiceDirs(serviceId?: GoogleServiceId) {
  const dirs = [JARVIS_DATA_DIR, GOOGLE_CREDENTIALS_DIR];
  const services = serviceId
    ? [getGoogleService(serviceId)].filter((service) => service !== undefined)
    : ['calendar', 'gmail'].map((id) => getGoogleService(id)).filter((service) => service !== undefined);

  for (const service of services) {
    dirs.push(path.dirname(getGoogleTokenPath(service.id)));
    if (service.runtime.stateDirName) {
      dirs.push(path.join(JARVIS_DATA_DIR, service.runtime.stateDirName));
    }
  }

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function baseEnv(): Record<string, string> {
  return {
    HOME: os.homedir(),
    PATH: `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${process.env.PATH ? `:${process.env.PATH}` : ''}`,
  };
}

export function getGoogleServiceEnv(serviceId: GoogleServiceId): Record<string, string> {
  const service = getGoogleService(serviceId);
  if (!service) {
    throw new Error(`Unknown Google service "${serviceId}"`);
  }

  ensureGoogleServiceDirs(serviceId);

  const env = {
    ...baseEnv(),
    [service.runtime.credentialEnvVar]: GOOGLE_CREDENTIALS_PATH,
  };
  const tokenPath = getGoogleTokenPath(serviceId);
  const stateDir = service.runtime.stateDirName
    ? path.join(JARVIS_DATA_DIR, service.runtime.stateDirName)
    : null;

  if (service.runtime.tokenPathEnvVar) {
    env[service.runtime.tokenPathEnvVar] = tokenPath;
  }
  if (service.runtime.xdgConfigHome) {
    env.XDG_CONFIG_HOME = JARVIS_DATA_DIR;
  }
  if (stateDir && service.runtime.stateDirEnvVar) {
    env[service.runtime.stateDirEnvVar] = stateDir;
  }
  if (stateDir && service.runtime.attachmentDirEnvVar) {
    env[service.runtime.attachmentDirEnvVar] = path.join(stateDir, 'attachments');
  }
  if (stateDir && service.runtime.downloadDirEnvVar) {
    env[service.runtime.downloadDirEnvVar] = path.join(stateDir, 'downloads');
  }

  return env;
}

export function getGoogleServiceEnvForServerName(serverName: string): Record<string, string> | null {
  const service = getGoogleServiceByServerName(serverName);
  if (!service) return null;
  return getGoogleServiceEnv(service.id);
}

export function getGoogleServiceRuntime(serviceId: string) {
  const service = getGoogleService(serviceId);
  if (!service) return null;

  return {
    ...service,
    credentialsPath: GOOGLE_CREDENTIALS_PATH,
    tokenPath: getGoogleTokenPath(service.id),
    env: getGoogleServiceEnv(service.id),
  };
}
