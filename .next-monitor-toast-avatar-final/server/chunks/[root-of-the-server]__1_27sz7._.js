module.exports=[70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},20635,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/action-async-storage.external.js",()=>require("next/dist/server/app-render/action-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},59043,(e,t,r)=>{t.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},66680,(e,t,r)=>{t.exports=e.x("node:crypto",()=>require("node:crypto"))},81111,(e,t,r)=>{t.exports=e.x("node:stream",()=>require("node:stream"))},23862,e=>e.a(async(t,r)=>{try{var a=await e.y("pg-587764f78a6c7a9c");e.n(a),r()}catch(e){r(e)}},!0),65661,e=>e.a(async(t,r)=>{try{let T;var a=e.i(66680),n=e.i(58574),s=t([n]);[n]=s.then?(await s)():s;let d=e=>(0,a.createHash)("sha256").update(e).digest("hex");async function o(){let e=await (0,n.db)();return T??=e.query(`
    CREATE TABLE IF NOT EXISTS agent_demo_links (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
      max_sessions INTEGER NOT NULL CHECK(max_sessions BETWEEN 1 AND 1000),
      used_sessions INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_demo_sessions (
      id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES agent_demo_links(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
      consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), consent_version TEXT NOT NULL,
      request_window TIMESTAMPTZ NOT NULL DEFAULT NOW(), request_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS agent_demo_sessions_active ON agent_demo_sessions(link_id,expires_at) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS agent_demo_rate (
      key TEXT PRIMARY KEY, window_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), hits INTEGER NOT NULL DEFAULT 1
    );
  `).then(()=>{}).catch(e=>{throw T=void 0,e}),await T,e}async function i(e){let t=await o();return!!(await t.query(`INSERT INTO agent_demo_rate(key) VALUES($1)
    ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' THEN 1 ELSE agent_demo_rate.hits+1 END,
      window_at=CASE WHEN agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' THEN NOW() ELSE agent_demo_rate.window_at END
    WHERE agent_demo_rate.hits<120 OR agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' RETURNING key`,[d(e)])).rowCount}async function E(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return null;let t=await o();return(await t.query(`SELECT l.*,a.name,a.avatar_url,a.accent,a.language,a.local_voice_id,a.speaks_first,a.conversation_style,
    COALESCE(NULLIF(a.agent_script,''),s.script_text,'') script
    FROM agent_demo_links l JOIN agents a ON a.id=l.agent_id
    JOIN agents owner ON owner.id=l.owner_id AND owner.role='ADMIN'
    JOIN admin_agent_owners o ON o.agent_id=a.id AND o.owner_id=l.owner_id AND o.verified=TRUE
    LEFT JOIN LATERAL (SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
    WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>NOW() AND a.role='AGENT'
    AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`,[d(e)])).rows[0]||null}let N={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow, noarchive"};e.s(["demoDb",0,o,"demoHash",0,d,"demoHeaders",0,N,"demoJson",0,(e,t=200)=>Response.json(e,{status:t,headers:N}),"demoLink",0,E,"demoRate",0,i,"demoToken",0,()=>(0,a.randomBytes)(32).toString("base64url")]),r()}catch(e){r(e)}},!1)];

//# sourceMappingURL=%5Broot-of-the-server%5D__1_27sz7._.js.map