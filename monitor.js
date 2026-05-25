const { Pool } = require("pg");
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_C1wINqPdF6vi@ep-shy-lab-anjni111-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});
async function check(seconds){
  const r = await pool.query("SELECT COUNT(*) as c FROM \"P2PCapacity\"");
  console.log("T+" + seconds + "s: " + r.rows[0].c + " records");
  if(Number(r.rows[0].c) > 0){
    const r2 = await pool.query("SELECT id, provider, \"createdAt\" FROM \"P2PCapacity\" ORDER BY id");
    r2.rows.forEach(rr => console.log("  " + rr.id + " - " + rr.provider + " - " + rr.createdAt));
  }
}
async function main(){
  await check(0);
  for(let t = 20; t <= 100; t += 20){
    await new Promise(r => setTimeout(r, 20000));
    await check(t);
  }
  pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
