import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../../lib/candidate-topics-reader';
import { getTopicsForDate, isValidDate } from '../../../lib/topics-api';
import { CATEGORIES } from '../../../lib/categories';

export async function GET(request: NextRequest) {
  const apiKey = process.env.TOPICS_API_KEY;
  if (!apiKey || request.headers.get('x-api-key') !== apiKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? undefined;
  const category = searchParams.get('category');

  if (date !== undefined && !isValidDate(date)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }
  if (category !== null && !CATEGORIES.some((c) => c.value === category)) {
    return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
  }

  const reader = new SupabaseCandidateTopicsReader(createServerSupabaseClient());
  const result = await getTopicsForDate(reader, category, date);
  return NextResponse.json(result);
}
