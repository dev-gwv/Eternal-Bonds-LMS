# Migrations

`supabase/migrations/` is **authoritative**. That is what `supabase db push` applies,
and it is the only place RLS policies, triggers and SQL functions live.

`packages/db/migrations/` is scratch output from `drizzle-kit generate` and is
gitignored. Use it as a draft, not a source of truth.

## Changing the schema

```bash
# 1. edit packages/db/src/schema.ts
bun db:generate                     # drizzle-kit writes a draft SQL file
# 2. read the draft, then fold the DDL into a new timestamped file in
#    supabase/migrations/ — adding RLS policies for any new table
supabase db push
```

Every new table needs `enable row level security` plus policies in the same
migration. A table with RLS enabled and no policy is unreadable by members,
which is the safe failure; a table without RLS is readable by everyone holding
an anon key, which is not.
