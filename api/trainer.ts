// api/trainer.ts
// Edge-safe handler: no process.env, no Node types needed.
export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (req.method === 'GET') {
    // Health-check in browser
    return json({ ok: true, route: '/api/trainer', runtime: 'edge' });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Only POST requests allowed' }, 405);
  }

  try {
    const { userText, memory, system } = await req.json();

    const lower = String(userText || '').toLowerCase();
    const text = lower.includes('macro')
      ? 'Macros = protein, carbs, fats. Rule: protein 1.6–2.2 g/kg, carbs 3–5 g/kg, fats ~0.7–1 g/kg.'
      : 'Coach online. Ask about training, injuries, or nutrition.';

    return json({ text, echo: { userText, memory, system } });
  } catch (e: any) {
    return json({ error: e?.message || 'Server error' }, 500);
  }
}
