import { NextRequest, NextResponse } from 'next/server';
import { isTokenValid, isMqttConnected, sendCommand } from '@/app/lib/bambu/mqtt-manager';

export async function POST(req: NextRequest) {
  if (!isTokenValid()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isMqttConnected()) return NextResponse.json({ error: 'MQTT not connected' }, { status: 503 });

  const { deviceId, command } = await req.json() as { deviceId?: string; command?: string };
  if (!deviceId || !command) return NextResponse.json({ error: 'deviceId and command required' }, { status: 400 });

  const valid = ['pause', 'resume', 'stop'];
  if (!valid.includes(command)) return NextResponse.json({ error: 'Invalid command' }, { status: 400 });

  const ok = sendCommand(deviceId, command as 'pause' | 'resume' | 'stop');
  if (!ok) return NextResponse.json({ error: 'MQTT publish failed' }, { status: 500 });
  return NextResponse.json({ success: true });
}
