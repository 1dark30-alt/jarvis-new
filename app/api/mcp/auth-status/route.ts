import { NextRequest, NextResponse } from 'next/server';
import { getGoogleService } from '@/app/lib/google-services';
import { getGoogleTokenPath } from '@/app/lib/mcp/google-service-runtime';
import fs from 'fs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const serviceId = searchParams.get('service') ?? 'calendar';
  const service = getGoogleService(serviceId);

  if (!service) {
    return NextResponse.json(
      { error: `Unknown Google service "${serviceId}"` },
      { status: 400 },
    );
  }

  const tokenPath = getGoogleTokenPath(service.id);
  const authenticated = fs.existsSync(tokenPath);
  return NextResponse.json({ serviceId: service.id, authenticated, tokenPath });
}
