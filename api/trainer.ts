// api/trainer.ts
// Edge-safe handler: no Node-only helpers, no Response.json.
// Uses the OpenAI "Responses" API and returns a friendly coach reply.

export const config = { runtime: 'edge' };

type Payload = {
  userText?: string;
  memory?: Record<string, unknown>;
  goal?: 'gain' | 'lose' | 'tone' | 'strength' | 'general';
  injuries?: string[];          // e.g. ["shoulder impingement", "knee pain"]
  weightLb?: number;
  recentLifts?: Array<{ name: string; best?: number; reps?: number }>;
};

function systemPromptFrom(p: Payload) {
  const goalsMap: Record<string, string> = {
    gain: 'hypertrophy & a mild caloric surplus',
    lose: 'fat loss & mild deficit',
    tone: 'body recomposition/balance',
    strength: 'maximum strength',
    general: 'general fitness',
  };

  const goalText = p.goal ? goalsMap[p.goal] ?? 'general fitness' : 'general fitness';
  const injuries = (p.injuries ?? []).join(', ') || 'none given';
  const weight = p.weightLb ? `${p.weightLb} lb` : 'unknown';
  const liftsText =
    (p.recentLifts ?? [])
      .slice(0, 5)
      .map((x) => `${x.name}${x.best ? ` best ${x.best} lb${x.reps ? ` × ${x.reps}` : ''}` : ''}`)
      .join('; ') || 'no recent lifts logged';

  return [
    'You are a friendly, knowledgeable strength & nutrition coach.',
    'Be concise, specific, and practical. Use clear bullets or short paragraphs.',
    'If a user mentions an injury, give safe substitutions (no pain) and brief cautions.',
    'If the question is about nutrition, give macros and example meals; convert g/kg to lb if helpful.',
    'If about programming, suggest sets/reps/RPE and simple progression rules.',
    '',
    `User context — goal: ${goalText}; weight: ${weight}; injuries: ${injuries}; recent lifts: ${liftsText}.`,
    'Avoid medical claims; always advise to see a professional for persistent pain.',
  ].join('\n');
}

function extractTextFromResponses(payload: any): string {
  // Responses API preferred: output_text
  const fromOutput = typeof payload?.output_text === 'string' ? payload.output_text.trim() : '';

  if (fromOutput) return fromOutput;

  // Fallback: scan the output blocks for text
  const blocks = (payload?.output ?? []) as Array<any>;
  const str = blocks
    .map((b) => {
      if (typeof b?.content === 'string') return b.content;
      if (Array.isArray(b?.content)) {
        return b.content
          .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
          .filter(Boolean)
          .join('\n');
      }
      if (typeof b?.text === 'string') return b.text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();

  return str || 'Coach online. Ask about training, injuries, or nutrition.';
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      ...init.headers,
    },
  });
}

export default async function handler(req: Request) {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userText = (body.userText ?? '').toString().trim();
  if (!userText) {
    return json({ error: 'userText is required' }, { status: 400 });
  }

  const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_EDGE; // allow either name
  if (!API_KEY) {
    // Safe local fallback so the app still works if key not set
    return json({
      text:
        "I'm ready to coach, but I can't reach the AI backend (missing OPENAI_API_KEY). " +
        'Ask your developer to set the env var in Vercel → Settings → Environment Variables.',
      echo: { userText },
    });
  }

  const system = systemPromptFrom(body);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [{ type: 'text', text: system }],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: userText }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json(
        {
          error: 'Upstream error',
          status: res.status,
          body: errText.slice(0, 3000),
        },
        { status: 502 },
      );
    }

    const payload = await res.json();
    const text = extractTextFromResponses(payload);

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
