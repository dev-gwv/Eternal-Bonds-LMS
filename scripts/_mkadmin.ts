import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const role = process.argv[2] ?? 'admin';
await db.execute(sql`update users set role = ${role} where email = 'tester@eternalbonds.test'`);
console.log(await db.execute(sql`select email, role from users where email = 'tester@eternalbonds.test'`));
process.exit(0);
