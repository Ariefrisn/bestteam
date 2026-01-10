// api.js
import { DB } from "./supabase.js";

const TOKEN = "STREAM_TEAM_2026_SECURE";
const ADMIN_PASS = "ADMIN2525";

/* ================= UTIL ================= */

function out(o) {
  return JSON.parse(JSON.stringify(o));
}

function imageHash(base64) {
  if (!base64 || !base64.includes(",")) return "";
  const bin = atob(base64.split(",")[1]);
  const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
  return crypto.subtle.digest("SHA-256", bytes)
    .then(buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""));
}

/* ================= WA TEXT ================= */

function buildWaText(lang = "en", d) {
  const status = "⏳ Status: PENDING (waiting for admin review)";
  if (lang === "id") return `Halo tim 👋
Saya telah submit stats hari ini di playlist ${d.playlist}.

${status}
Check-in ke-${d.count}

👤 Username: ${d.username}
🆔 Team ID: ${d.teamId}

Terima kasih.`;

  if (lang === "es") return `Hola equipo 👋
He enviado mis estadísticas hoy en la playlist ${d.playlist}.

${status}
Check-in #${d.count}

👤 Usuario: ${d.username}
🆔 Team ID: ${d.teamId}

Gracias.`;

  return `Hi team 👋
I’ve submitted my stats today in the playlist ${d.playlist}.

${status}
Check-in #${d.count}

👤 Username: ${d.username}
🆔 Team ID: ${d.teamId}

Thanks.`;
}

/* =================================================
   API HANDLER (GANTI stream.php)
================================================= */

export async function api(params = {}) {
  if (params.token !== TOKEN) {
    return out({ status: "unauthorized" });
  }

  const type = params.type;

  /* ============== CHECKIN USER ============== */
  if (type === "checkin" && params.username) {

    const team = params.team_id?.trim();
    const user = params.username.toLowerCase().trim();
    const playlist = params.playlist?.trim();
    const count = Number(params.count || 0);
    const lastfm = params.lastfm?.trim() || "";
    const proof = params.proof_base64 || "";

    if (!team || !user || !playlist || (!proof && !lastfm)) {
      return out({ status: "REJECTED", message: "Incomplete data" });
    }

    // Team binding
    const { data: bind } = await DB.checkin()
      .select("username")
      .eq("team_id", team)
      .limit(1);

    if (bind?.length && bind[0].username !== user) {
      return out({ status: "REJECTED", message: "Team ID already bound" });
    }

    // Image duplicate
    let hash = "";
    if (proof) {
      hash = await imageHash(proof);
      const { data: dup } = await DB.checkin()
        .select("id")
        .eq("image_hash", hash)
        .limit(1);

      if (dup?.length) {
        return out({ status: "REJECTED", message: "Duplicate image detected" });
      }
    }

    await DB.checkin().insert({
      username: user,
      playlist,
      count,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 19),
      proof,
      lastfm,
      status: "PENDING",
      reject_reason: "",
      team_id: team,
      image_hash: hash,
      verified_type: "MANUAL"
    });

    const { data: pl } = await DB.playlist()
      .select("wa_link")
      .eq("playlist_name", playlist)
      .limit(1);

    const wa = pl?.[0]?.wa_link || "";
    const wa_text = wa
      ? buildWaText(params.lang || "en", { playlist, count, username: user, teamId: team })
      : "";

    return out({ status: "PENDING", wa, wa_text });
  }

  /* ============== HISTORY ============== */
  if (type === "checkin") {
    const { data } = await DB.checkin()
      .select("*")
      .order("id", { ascending: false });
    return out(data || []);
  }

  /* ============== PLAYLIST ============== */
  if (type === "playlist") {
    const { data } = await DB.playlist().select("playlist_name,playlist_link,wa_link");
    return out(
      (data || []).map(x => ({
        name: x.playlist_name,
        spotify: x.playlist_link,
        wa: x.wa_link
      }))
    );
  }

  /* ============== ADVANCE ============== */
  if (type === "advance") {
    const TARGET = 6;
    const { data } = await DB.checkin().select("username,playlist,count");

    const map = {};
    for (const r of data || []) {
      const k = r.username.toLowerCase() + "|" + r.playlist;
      map[k] = (map[k] || 0) + r.count;
    }

    return out(
      Object.entries(map).map(([k, weekly]) => {
        const [username, playlist] = k.split("|");
        return {
          username,
          playlist,
          weekly_stream: weekly,
          balance: weekly - TARGET,
          status: weekly < TARGET ? "CRITICAL" : weekly === TARGET ? "USING" : "OK"
        };
      })
    );
  }

  /* ============== ADMIN AUTH ============== */
  if (type === "admin_auth") {
    if (params.admin_password !== ADMIN_PASS)
      return out({ status: "unauthorized" });
    return out({ status: "ok", role: "admin" });
  }

  return out({});
}
