// api/trainer.ts
// Minimal JSON endpoint that calls OpenAI Responses API and returns plain text.
// Uses global fetch/Request/Response provided by the Node 22 runtime.

const MODEL = 'gpt-4o-mini';

// Prefer structured output from Responses API, fall back to output_text.
function extractTextFromResponsesAPI(payload: any): string {
  const fromBlocks =
    payload?.output?.[0]?.content
      ?.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      ?.filter(Boolean)
      ?.join(' ')
      ?.trim() || '';

  const fallback = typeof payload?.output_text === 'string'
    ? payload.output_text.trim()
    : '';

  return fromBlocks || fallback || '';
}

function systemPrompt({
  goal,
  injuries,
  weightLb,
  recentLifts,
}: {
  goal?: string;
  injuries?: string[];
  weightLb?: number | string;
  recentLifts?: Array<{ name: string; best: string }>;
}) {
  const goalsMap: Record<string, string> = {
    gain: 'hypertrophy & mild surplus',
    lose: 'fat loss & mild deficit',
    tone: 'body recomposition/balance',
    strength: 'max strength',
    weight_loss: 'fat loss',
    general: 'general fitness',
  };

  const injuriesStr = injuries?.length ? injuries.join(', ') : 'none reported';
  const recent =
    recentLifts?.length
      ? recentLifts.map(r => `${r.name}: ${r.best}`).join('; ')
      : 'none logged';

  const goalStr = goal && goalsMap[goal] ? goalsMap[goal] : (goal || 'general fitness');

  return `
You are a friendly, practical strength & nutrition coach. Speak concisely, like a human.
Avoid medical claims. If an exercise is risky for a given injury, give swaps.

Client snapshot:
- Primary goal: ${goalStr}
- Bodyweight: ${weightLb ?? 'unknown'} lb
- Injuries/constraints: ${injuriesStr}
- Recent lifts: ${recent}

Coaching style:
- Offer actionable guidance first.
- For injuries, offer at least 2 safer swap options and clear cues.
- For nutrition, give grams per kg (or per lb) and easy meal ideas.

If user asks "what's a macro?":
- Answer: "Macros = protein, carbs, fats."
- Rule of thumb (by body weight): protein 1.6–2.2 g/kg, carbs 3–5 g/kg (more on training days), fats ~0.7–1 g/kg.
`.trim();
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userText = String(body?.userText ?? '').trim();
  const memory = body?.memory ?? {};
  const goal = body?.goal;
  const injuries: string[] | undefined = Array.isArray(body?.injuries) ? body.injuries : undefined;
  const weightLb: number | string | undefined = body?.weightLb;
  const recentLifts = body?.recentLifts;

  if (!userText) {
    return json({ error: 'Missing userText' }, { status: 400 });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not set in environment' }, { status: 500 });
  }

  const sys = systemPrompt({ goal, injuries, weightLb, recentLifts });

  // Call OpenAI Responses API
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: 'system', content: sys },
        { role: 'user', content: userText }
      ],
      // Small, fast completion
      max_output_tokens: 350
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return json({
      error: 'Upstream error',
      status: res.status,
      body: errText.slice(0, 3000),
    }, { status: 502 });
  }

  const payload = await res.json();
  const text = extractTextFromResponsesAPI(payload);

  return json({ text, echo: { userText, memory } });
}
