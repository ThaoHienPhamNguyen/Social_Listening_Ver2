// Supabase silently caps any single response at the project's "Max Rows"
// setting (1000 by default) no matter what .limit() a query requests —
// there is no error and no truncation flag to check. A single-day or 7-day
// window that grows past that cap loses rows with zero visible sign (this
// is exactly what happened to Buzz Trend's most recent days: the articles
// and threads_engagement_daily rows existed the whole time, just past the
// point an unpaginated, unordered fetch ever reached). Paging with
// .range() and a stable tiebreak order in the caller fetches every row
// regardless of how large the table grows.
export const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    results.push(...rows);
    if (rows.length < PAGE_SIZE) return results;
    from += PAGE_SIZE;
  }
}
