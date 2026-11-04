import { NextResponse } from 'next/server';
import { getTelemetry, isTokenValid, isMqttConnected, getToken, connectMqtt } from '@/app/lib/bambu/mqtt-manager';

export async function GET() {
  if (!isTokenValid()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Reconnect if MQTT dropped
  if (!isMqttConnected()) {
    const token = getToken();
    if (token) connectMqtt(token).catch(() => {});
  }

  return NextResponse.json(getTelemetry());
}
