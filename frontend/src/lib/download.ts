/* Saves a file from the SpendWise API (the .json backup and the .csv export).

   A plain <a download href="/api/export/..."> hands the request to the browser's download manager, which reports
   every failure as the same vague "File wasn't available on site". Fetching it here uses the same same-origin
   request as the rest of the app (session cookie included), so a failure becomes a readable message. */

function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json, text/csv, */*' } });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const type = res.headers.get('content-type') ?? '';

  if (!res.ok) {
    let detail = '';
    if (type.includes('application/json')) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (body && typeof body.error === 'string') detail = body.error;
    }
    if (res.status === 401) throw new Error(detail || 'Your session has ended. Please log in again.');
    throw new Error(detail || `The server refused the download (HTTP ${res.status}).`);
  }

  // A 200 that is really the website's own page means /api/export/... never reached the backend (hosting rewrite).
  if (type.includes('text/html')) {
    throw new Error('The server sent a web page instead of the file. The /api rewrite on the host is not forwarding this address.');
  }

  const blob = await res.blob();
  const name = filenameFrom(res, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
