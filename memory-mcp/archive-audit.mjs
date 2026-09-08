


export const KINDS = Object.freeze({
  SEAL: "seal", 
  OPEN: "open", 
  WIPE_PLANNED: "wipe_planned", 
  WIPE_DONE: "wipe_done", 
});
const KIND_SET = new Set(Object.values(KINDS));


export const REJECT_UNKNOWN_KIND = "知らない種別です";
export const REJECT_NO_ENDPOINT = "設定を読めません";
export const REJECT_NOT_ACCEPTED = "記録が残せませんでした";
export const REJECT_SECRET_IN_ENTRY = "送れない値が含まれています";
export const REJECT_MISSING_FIELD = "必要な項目がありません";


function reject(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}


export const CODES = Object.freeze({
  NO_ENDPOINT: "E_NO_ENDPOINT",
  HTTP_ERROR: "E_HTTP_ERROR",
  NOT_JSON: "E_NOT_JSON",
  NO_AUDIT_ID: "E_NO_AUDIT_ID",
  SECRET_IN_ENTRY: "E_SECRET_IN_ENTRY",
  MISSING_FIELD: "E_MISSING_FIELD",
  UNKNOWN_KIND: "E_UNKNOWN_KIND",
});


const TIMEOUT_MS = 10_000;


export async function writeAudit(entry, opts = {}) {
  const { endpoint, token, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = opts;
  if (!endpoint) throw reject(CODES.NO_ENDPOINT, REJECT_NO_ENDPOINT);
  assertEntry(entry);

  const body = { ...entry, at: entry.at ?? new Date().toISOString() };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  
  
  if (!res.ok) {
    throw reject(CODES.HTTP_ERROR, REJECT_NOT_ACCEPTED);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    throw reject(CODES.NOT_JSON, REJECT_NOT_ACCEPTED);
  }
  const id = json?.audit_id;
  if (typeof id !== "string" || id.length === 0) {
    throw reject(CODES.NO_AUDIT_ID, REJECT_NOT_ACCEPTED);
  }
  return id;
}


export function makeAuditWriter(opts) {
  return async (entry) => {
    await writeAudit({ kind: KINDS.OPEN, ...entry }, opts);
  };
}


export async function recordWipePlanned({ actor, reason, targets }, opts) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`${REJECT_MISSING_FIELD}: targets`);
  }
  for (const t of targets) {
    if (typeof t?.path !== "string" || t.path.length === 0) {
      throw new Error(`${REJECT_MISSING_FIELD}: targets[].path`);
    }
    if (!Number.isFinite(t?.bytes) || !Number.isFinite(t?.files)) {
      throw new Error(`${REJECT_MISSING_FIELD}: targets[].bytes / files`);
    }
  }
  return writeAudit(
    {
      kind: KINDS.WIPE_PLANNED,
      actor,
      reason,
      targets,
      totalBytes: targets.reduce((a, t) => a + t.bytes, 0),
      totalFiles: targets.reduce((a, t) => a + t.files, 0),
    },
    opts,
  );
}


export async function recordWipeDone({ planId, actor, confirmed, unconfirmedReason }, opts) {
  if (typeof planId !== "string" || planId.length === 0) {
    throw new Error(`${REJECT_MISSING_FIELD}: planId（先に recordWipePlanned を送ってください）`);
  }
  if (typeof confirmed !== "boolean") {
    throw new Error(`${REJECT_MISSING_FIELD}: confirmed（確かめられたかを省略できません）`);
  }
  if (confirmed === false && !unconfirmedReason) {
    throw new Error(`${REJECT_MISSING_FIELD}: unconfirmedReason（確かめられない理由が要ります）`);
  }
  return writeAudit(
    { kind: KINDS.WIPE_DONE, planId, actor, confirmed, unconfirmedReason },
    opts,
  );
}


import { isSecretKeyName, looksLikeSecretValue } from './filters.mjs';

function assertEntry(entry) {
  if (!entry || typeof entry !== "object") throw new Error(`${REJECT_MISSING_FIELD}: entry`);
  if (!KIND_SET.has(entry.kind)) {
    throw new Error(`${REJECT_UNKNOWN_KIND}（${JSON.stringify(entry.kind)}）`);
  }
  if (!entry.actor) throw new Error(`${REJECT_MISSING_FIELD}: actor`);
  walk(entry, []);
}

function walk(node, path) {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    if (looksLikeSecretValue(node)) {
      
      throw reject(CODES.SECRET_IN_ENTRY, `${REJECT_SECRET_IN_ENTRY}（${path.join(".")}）`);
    }
    return;
  }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (isSecretKeyName(k)) {
      throw new Error(`${REJECT_SECRET_IN_ENTRY}（項目名 ${[...path, k].join(".")}）`);
    }
    walk(v, [...path, k]);
  }
}





async function selftest() {
  let pass = 0;
  let fail = 0;
  const t = async (name, fn) => {
    try {
      await fn();
      pass++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      fail++;
      console.log(`  ❌ ${name}\n     ${e.code || 'failed'}`);
    }
  };
  const must = (c, m) => {
    if (!c) throw new Error(m);
  };
  
  const mustRejectWith = async (fn, expected, why) => {
    let msg = null;
    let code = null;
    try {
      await fn();
    } catch (e) {
      msg = (e.code || 'failed');
      code = e.code;
    }
    must(msg !== null, `落ちるはずが通った: ${why}`);
    
    
    
    if (typeof expected === "string" && expected.startsWith("E_")) {
      must(code === expected, `拒否理由が違う（偶然落ちただけの可能性）: code=${code} / ${msg}`);
    } else {
      must(msg.includes(expected), `拒否理由が違う（偶然落ちただけの可能性）: ${msg}`);
    }
  };

  const sent = [];
  const okFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ audit_id: `a${sent.length}` }),
    };
  };
  
  const ghostFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const opts = { endpoint: "https://example.invalid/audit", token: "t", fetchImpl: okFetch };

  console.log("\n■ 陽性対照（正しい経路が通るか）");
  await t("記録が送れて記録IDが返る", async () => {
    const id = await writeAudit({ kind: KINDS.SEAL, actor: "system", archiveId: "a1" }, opts);
    must(id === "a1", `記録IDが返らない: ${id}`);
    must(sent.at(-1).body.at, "時刻が入っていない");
  });
  await t("消す前の記録に総サイズと件数が入る", async () => {
    await recordWipePlanned(
      {
        actor: "system",
        reason: "契約終了",
        targets: [
          { path: "/x/agent", bytes: 100, files: 3 },
          { path: "/x/plugin", bytes: 50, files: 2 },
        ],
      },
      opts,
    );
    const b = sent.at(-1).body;
    must(b.totalBytes === 150, `総サイズが違う: ${b.totalBytes}`);
    must(b.totalFiles === 5, `件数が違う: ${b.totalFiles}`);
  });
  await t("確かめられた消去を記録できる", async () => {
    await recordWipeDone({ planId: "a2", actor: "system", confirmed: true }, opts);
    must(sent.at(-1).body.confirmed === true, "confirmed が残らない");
  });
  await t("🔴 確かめられない消去は理由つきで記録される（③Claude Code本体）", async () => {
    await recordWipeDone(
      {
        planId: "a2",
        actor: "system",
        confirmed: false,
        unconfirmedReason: "確かめる側ごと消えるため",
      },
      opts,
    );
    const b = sent.at(-1).body;
    must(b.confirmed === false, "confirmed が false で残らない");
    must(b.unconfirmedReason.length > 0, "理由が残らない");
  });
  await t("復号の記録として crypto-envelope に渡せる", async () => {
    const w = makeAuditWriter(opts);
    await w({ actor: "owner", purpose: "consult", archiveId: "a1" });
    must(sent.at(-1).body.kind === KINDS.OPEN, "種別が open にならない");
  });

  console.log("\n■ 🔴 200 だけでは受理と判定しない（存在しない口にも200が返る）");
  await t("200 でも記録IDが無ければ失敗にする", async () => {
    await mustRejectWith(
      () => writeAudit({ kind: KINDS.SEAL, actor: "x" }, { ...opts, fetchImpl: ghostFetch }),
      REJECT_NOT_ACCEPTED,
      "存在しない口への送信が成功扱いになった",
    );
  });
  await t("応答がJSONでなければ失敗にする", async () => {
    const badFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await mustRejectWith(
      () => writeAudit({ kind: KINDS.SEAL, actor: "x" }, { ...opts, fetchImpl: badFetch }),
      REJECT_NOT_ACCEPTED,
      "HTMLの応答が成功扱いになった",
    );
  });
  await t("4xx/5xx は失敗にする", async () => {
    
    
    
    
    for (const status of [401, 403, 404, 500]) {
      await mustRejectWith(
        () =>
          writeAudit(
            { kind: KINDS.SEAL, actor: "x" },
            {
              ...opts,
              fetchImpl: async () => ({
                ok: false,
                status,
                json: async () => ({ audit_id: "should-not-be-trusted" }),
              }),
            },
          ),
        CODES.HTTP_ERROR,
        `HTTP ${status} が成功扱いになった`,
      );
    }
  });

  console.log("\n■ 陰性対照（欠けたら拒否するか）");
  await t("知らない種別は送れない", async () => {
    for (const kind of ["delete", "", undefined, 1]) {
      await mustRejectWith(
        () => writeAudit({ kind, actor: "x" }, opts),
        REJECT_UNKNOWN_KIND,
        `種別 ${kind} が通った`,
      );
    }
  });
  await t("送り先が無ければ送らない（黙って捨てない）", async () => {
    await mustRejectWith(
      () => writeAudit({ kind: KINDS.SEAL, actor: "x" }, { fetchImpl: okFetch }),
      REJECT_NO_ENDPOINT,
      "送り先なしで通った",
    );
  });
  await t("誰がやったか無しでは記録できない", async () => {
    await mustRejectWith(
      () => writeAudit({ kind: KINDS.SEAL }, opts),
      REJECT_MISSING_FIELD,
      "actor 無しで通った",
    );
  });
  await t("消す対象が空では記録できない", async () => {
    for (const targets of [undefined, [], "x"]) {
      await mustRejectWith(
        () => recordWipePlanned({ actor: "x", targets }, opts),
        REJECT_MISSING_FIELD,
        `targets=${JSON.stringify(targets)} が通った`,
      );
    }
  });
  await t("サイズ・件数の無い対象は記録できない", async () => {
    await mustRejectWith(
      () => recordWipePlanned({ actor: "x", targets: [{ path: "/x" }] }, opts),
      REJECT_MISSING_FIELD,
      "bytes/files 無しで通った",
    );
  });
  await t("消す前の記録なしに「消した」を送れない", async () => {
    await mustRejectWith(
      () => recordWipeDone({ actor: "x", confirmed: true }, opts),
      REJECT_MISSING_FIELD,
      "planId 無しで通った",
    );
  });
  await t("🔴 確かめたかを省略できない", async () => {
    await mustRejectWith(
      () => recordWipeDone({ planId: "a1", actor: "x" }, opts),
      REJECT_MISSING_FIELD,
      "confirmed 無しで通った",
    );
  });
  await t("🔴 確かめられないのに理由を書かないのは通さない", async () => {
    await mustRejectWith(
      () => recordWipeDone({ planId: "a1", actor: "x", confirmed: false }, opts),
      REJECT_MISSING_FIELD,
      "理由なしの未確認が通った",
    );
  });

  console.log("\n■ 秘密の値が記録に混ざらないか");
  await t("秘密らしい項目名は拒否する", async () => {
    for (const key of ["token", "api_key", "PASSWORD", "kek", "authorization"]) {
      await mustRejectWith(
        () => writeAudit({ kind: KINDS.SEAL, actor: "x", [key]: "v" }, opts),
        REJECT_SECRET_IN_ENTRY,
        `項目名 ${key} が通った`,
      );
    }
  });
  await t("入れ子の中の秘密らしい項目名も拒否する", async () => {
    await mustRejectWith(
      () => writeAudit({ kind: KINDS.SEAL, actor: "x", meta: { deep: { secret: "v" } } }, opts),
      REJECT_SECRET_IN_ENTRY,
      "入れ子の secret が通った",
    );
  });
  await t("秘密らしい値の形は拒否する（値は出さない）", async () => {
    const samples = [
      "sk-" + "a".repeat(24),
      "ghp_" + "b".repeat(20),
      "xoxb-" + "1".repeat(16),
      "eyJ" + "c".repeat(12) + "." + "d".repeat(12) + ".x",
    ];
    for (const v of samples) {
      let msg = null;
      try {
        await writeAudit({ kind: KINDS.SEAL, actor: "x", note: v }, opts);
      } catch (e) {
        msg = (e.code || 'failed');
      }
      must(msg !== null, `秘密らしい値が通った`);
      must(msg.includes(REJECT_SECRET_IN_ENTRY), `拒否理由が違う: ${msg}`);
      must(!msg.includes(v), `🔴 エラー文に値そのものが出ている`);
      
      must(!/\d+ 文字/.test(msg), `長さが出ている: ${msg}`);
      
      must(/[（(]\S+[）)]/.test(msg), `項目名が出ていない＝利用者が直せない: ${msg}`);
    }
  });
  await t("普通の記録は秘密判定に引っかからない（誤検知の確認）", async () => {
    await writeAudit(
      { kind: KINDS.SEAL, actor: "system", archiveId: "arch-001", reason: "契約終了" },
      opts,
    );
  });

  console.log("\n■ 待ち上限");
  await t("応答が返らないと待ち続けずに落ちる", async () => {
    const hang = (_u, init) =>
      new Promise((_, rej) => {
        init.signal.addEventListener("abort", () => rej(new Error("AbortError")));
      });
    let msg = null;
    try {
      await writeAudit({ kind: KINDS.SEAL, actor: "x" }, { ...opts, fetchImpl: hang, timeoutMs: 50 });
    } catch (e) {
      msg = (e.code || 'failed');
    }
    must(msg !== null, "無限に待った");
  });

  console.log(`\n合計: ${pass} 件合格 / ${fail} 件失敗`);
  return fail === 0 ? 0 : 1;
}

if (process.argv.includes("--selftest")) {
  process.exit(await selftest());
}
