export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/hello/text") {
      return handleTextHello(request, env);
    }

    if (url.pathname === "/") {
      url.pathname = "/index.html";
    } else if (url.pathname === "/article") {
      url.pathname = "/article.html";
    }

    const assetRequest = new Request(url.toString(), request);
    const response = await env.ASSETS.fetch(assetRequest);

    return response;
  },
};

async function handleTextHello(request, env) {
  if (!env.HELLO_DB) {
    return json({ error: "D1 binding HELLO_DB is not configured." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const comment = String(payload?.comment || "").trim();
  const website = String(payload?.website || "").trim();
  const elapsedMs = Number(payload?.elapsedMs || 0);

  if (website) {
    return json({ error: "Spam detected." }, 400);
  }

  if (!Number.isFinite(elapsedMs) || elapsedMs < 800) {
    return json({ error: "Submission blocked." }, 400);
  }

  if (!comment) {
    return json({ error: "Comment is required." }, 400);
  }

  await env.HELLO_DB.prepare(
    "INSERT INTO hello_comments (id, comment, created_at) VALUES (?1, ?2, ?3)"
  )
    .bind(crypto.randomUUID(), comment, new Date().toISOString())
    .run();

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
