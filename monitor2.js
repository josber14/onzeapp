const { Pool } = require("pg");
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_C1wINqPdF6vi@ep-shy-lab-anjni111-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});
let lastCount = -1;
async function check(msg) {
  const r = await pool.query("SELECT COUNT(*) as c FROM \"P2PCapacity\"");
  const c = Number(r.rows[0].c);
  if (c !== lastCount) {
    console.log(new Date().toISOString(), msg, "- Count:", c);
    if (c > 0) {
      const r2 = await pool.query("SELECT id, \"createdAt\", EXTRACT(EPOCH FROM (NOW() - \"createdAt\")) as age FROM \"P2PCapacity\" ORDER BY id");
      r2.rows.forEach(row => console.log("  ", row.id, "createdAt:", row.createdAt, "age:", Math.round(row.age), "s"));
    }
    lastCount = c;
  }
  return c;
}
(async () => {
  // Delete
  await pool.query("DELETE FROM \"P2PCapacity\"");
  await check("After delete");
  // Watch for 5 minutes
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const c = await check("Tick " + ((i+1)*2) + "s");
  }
  pool.end();
  console.log("Done monitoring");
})().catch(e => { console.error(e.message); pool.end(); });
