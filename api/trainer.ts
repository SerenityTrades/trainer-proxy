// api/trainer.ts
/* Modern functions runtime (nodejs22.x) + Web Fetch API */

const MODEL = 'gpt-4o-mini';

/** Try to read text from the Responses API payload */
function extractTextFromResponsesAPI(payload: any): string {
  const fromBlocks =
    payload?.output?.[0]?.content
      ?.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      ?.filter(Boolean)
      ?.join(' ')
      ?.trim() || '';

  const fallback = typeof payload?.output_text === 'string' ? payload.output_text.trim() : '';
  return fromBlocks || fallback || '';
}

/** Small JSON helper that always sets correct headers */
function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json({ error: 'Use POST with { userText }' }, { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userText = String(body?.userText || '').trim();
  if (!userText) return json({ error: 'Missing userText' }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: 'Server missing OPENAI_API_KEY' }, { status: 500 });

  // Build a compact prompt – adjust freely
  const sys = [
    'You are a concise, practical strength coach.',
    'If asked about nutrition, include a quick macro rule of thumb with grams per kg.',
    'If asked about injuries, suggest conservative, safe swaps.',
    'Keep answers short and specific.',
  ].join(' ');

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: sys },
          { role: 'user', content: userText },
        ],
        // Lightweight output – Responses API will return structured + output_text
        // temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json(
        {
          error: 'Upstream error',
          status: res.status,
          details: errText.slice(0, 2000),
        },
        { status: 502 },
      );
    }

    const payload = await res.json();
    const text = extractTextFromResponsesAPI(payload) || '(No content)';
    return json({ text, echo: { userText } });
  } catch (e: any) {
    return json(
      {
        error: 'Failed to reach OpenAI',
        detail: String(e?.message ?? e),
      },
      { status: 502 },
    );
  }
}
