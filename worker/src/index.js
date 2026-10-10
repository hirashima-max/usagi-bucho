/**
 * usagi-form — receives form posts from the うさぎ部長 site,
 * verifies a Cloudflare Turnstile token, then emails via Resend.
 *
 * Accepts multipart/form-data or JSON with:
 *   form:  "contact" | "newsletter"
 *   name, email, message, interest (contact)
 *   name, email (newsletter)
 *   cf-turnstile-response  (Turnstile token)
 *   _honey                 (honeypot, must be empty)
 */

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    ok,
    headers: {
      "access-control-allow-origin": ok ? origin : allowed[0] || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "origin",
    },
  };
}

async function readBody(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await request.json();
  const fd = await request.formData();
  return Object.fromEntries(fd.entries());
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) return { success: true, skipped: true }; // not configured yet
  if (!token) return { success: false };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return await r.json();
}

async function sendMail(env, { to, subject, html, replyTo }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return await r.json();
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const c = cors(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405, c.headers);
    if (!c.ok) return json({ ok: false, error: "origin" }, 403, c.headers);

    let d;
    try { d = await readBody(request); } catch { return json({ ok: false, error: "body" }, 400, c.headers); }

    // Honeypot: bots fill hidden fields
    if (d._honey) return json({ ok: true }, 200, c.headers);

    const form = d.form === "newsletter" ? "newsletter" : "contact";
    const name = String(d.name || "").trim().slice(0, 100);
    const email = String(d.email || "").trim().slice(0, 200);
    if (!name || !isEmail(email)) return json({ ok: false, error: "invalid" }, 400, c.headers);

    const ip = request.headers.get("cf-connecting-ip");
    const ts = await verifyTurnstile(d["cf-turnstile-response"], ip, env.TURNSTILE_SECRET);
    if (!ts.success) return json({ ok: false, error: "turnstile" }, 403, c.headers);

    if (!env.RESEND_API_KEY) return json({ ok: false, error: "not_configured" }, 500, c.headers);

    const when = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    try {
      if (form === "newsletter") {
        await sendMail(env, {
          to: env.OWNER_EMAIL,
          subject: `【うさぎ部長サイト】メルマガ登録: ${name}`,
          replyTo: email,
          html: `<h2>メルマガ登録</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">
<tr><td><b>お名前</b></td><td>${esc(name)}</td></tr>
<tr><td><b>メール</b></td><td>${esc(email)}</td></tr>
<tr><td><b>日時</b></td><td>${esc(when)}</td></tr>
<tr><td><b>IP</b></td><td>${esc(ip)}</td></tr>
</table>`,
        });
        if (env.SEND_WELCOME === "true") {
          await sendMail(env, {
            to: email,
            subject: "【うさぎ部長】登録ありがとうございます ― 読書リストはこちら",
            html: `<p>${esc(name)} さん</p>
<p>メルマガへのご登録ありがとうございます。登録特典の読書リストはこちらです。</p>
<p><a href="${esc(env.GIFT_URL)}">${esc(env.GIFT_URL)}</a></p>
<p>外資の年収と評価の仕組みについて、不定期でお届けします。<br>うさぎ部長</p>`,
          });
        }
        return json({ ok: true, url: env.GIFT_URL }, 200, c.headers);
      }

      // contact
      const message = String(d.message || "").trim().slice(0, 5000);
      const interest = String(d.interest || "").trim().slice(0, 100);
      if (!message) return json({ ok: false, error: "invalid" }, 400, c.headers);
      await sendMail(env, {
        to: env.OWNER_EMAIL,
        subject: `【うさぎ部長サイト】新しい相談: ${name}`,
        replyTo: email,
        html: `<h2>新しい相談</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">
<tr><td><b>お名前</b></td><td>${esc(name)}</td></tr>
<tr><td><b>メール</b></td><td>${esc(email)}</td></tr>
<tr><td><b>ご希望</b></td><td>${esc(interest)}</td></tr>
<tr><td><b>日時</b></td><td>${esc(when)}</td></tr>
<tr><td><b>IP</b></td><td>${esc(ip)}</td></tr>
</table>
<h3>今、迷っていること</h3>
<p style="white-space:pre-wrap;font-family:sans-serif">${esc(message)}</p>`,
      });
      return json({ ok: true }, 200, c.headers);
    } catch (e) {
      return json({ ok: false, error: "send_failed", detail: String(e.message || e) }, 502, c.headers);
    }
  },
};
