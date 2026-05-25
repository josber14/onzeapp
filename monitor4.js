const { Pool } = require("pg");
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_C1wINqPdF6vi@ep-shy-lab-anjni111.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
});
let lastCount = -1;
const checks = [];
(async () => {
  for(let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await pool.query('SELECT COUNT(*) as c FROM "P2PCapacity"');
    const c = Number(r.rows[0].c);
    checks.push(String(c));
    if(c !== lastCount) {
      console.log(new Date().toISOString(), "Count:", c);
      lastCount = c;
    }
  }
  console.log("All counts:", checks.join(", "));
  console.log("Done (60s)");
  pool.end();
})().catch(e => { console.error(e.message); pool.end(); });
