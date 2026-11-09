// Read-only operator aid: never prints scripts, knowledge, credentials or connection strings.
const {Pool}=require('pg');
const {createHash}=require('node:crypto');
async function main(){
  const [agentId,ownerId]=process.argv.slice(2);
  if(!agentId||!ownerId||agentId.length>100||ownerId.length>100)throw Error('usage');
  const pool=new Pool({connectionString:process.env.DATABASE_URL||process.env.DIRECT_URL,connectionTimeoutMillis:10000});
  if(!process.env.DATABASE_URL&&!process.env.DIRECT_URL)throw Error('configuration');
  try{
    const r=await pool.query(`SELECT a.id,a.name,a.local_voice_id,a.accent,a.language,a.speaks_first,a.conversation_style,
      COALESCE(NULLIF(a.agent_script,''),sc.script_text,'') script FROM agents a
      JOIN admin_agent_owners o ON o.agent_id=a.id AND o.owner_id=$2 AND o.verified=TRUE
      JOIN agents owner ON owner.id=o.owner_id AND owner.role='ADMIN' AND owner.status='APPROVED'
      LEFT JOIN LATERAL (SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) sc ON TRUE
      WHERE a.id=$1 AND a.role='AGENT' AND a.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`,[agentId,ownerId]);
    const a=r.rows[0];if(!a)throw Error('access');
    const hash=createHash('sha256').update(JSON.stringify([a.id,a.name,a.local_voice_id,a.accent,a.language,a.speaks_first,a.conversation_style,a.script])).digest('hex');
    process.stdout.write(JSON.stringify({agentId:a.id,configurationHash:hash})+'\n');
  }finally{await pool.end();}
}
main().catch(()=>{process.stderr.write('Unable to read agent fingerprint. Check agent/verified owner IDs and backend database configuration. No database records were changed.\n');process.exitCode=1;});
