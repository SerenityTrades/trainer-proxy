export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('OK');
  try {
    const { userText, memory, system } = await req.json();

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY!}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: system },
          { role: 'developer', content: `Chat memory:\n${memory || ''}` },
          { role: 'user', content: userText || '' }
        ]
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return new Response(JSON.stringify({ error: text }), { status: r.status });
    }

    const data = await r.json();
    const text =
      data?.output?.[0]?.content?.map((c: any) => c?.text).filter(Boolean).join(' ').trim() ||
      data?.output_text ||
      'Sorry, I could not generate a response.';
    return Response.json({ text });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Server error' }), { status: 500 });
  }
}
