import { NextResponse } from 'next/server';
import { availableModels } from '@/lib/mcp/tools';

export async function GET() {
  return NextResponse.json({
    models: availableModels,
  });
}
