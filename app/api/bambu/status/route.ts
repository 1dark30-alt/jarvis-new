import { NextResponse } from 'next/server';
import { isTokenValid, isMqttConnected, getPrinters, getToken, connectMqtt } from '@/app/lib/bambu/mqtt-manager';

export async function GET() {
  const valid = isTokenValid();

  // If token is valid but MQTT isn't connected, attempt to reconnect
  if (valid && !isMqttConnected()) {
    const token = getToken();
    if (token) connectMqtt(token).catch(() => {});
  }

  return NextResponse.json({
    authenticated: valid,
    mqttConnected: isMqttConnected(),
    printerCount: getPrinters().length,
  });
}

export async function DELETE() {
  const { setToken } = await import('@/app/lib/bambu/mqtt-manager');
  setToken(null);
  return NextResponse.json({ success: true });
}
