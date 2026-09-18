-- Expression + trigram indexes so Prisma's case-insensitive filters stay
-- index-assisted on the 30M+ row Account table:
--   { in: [...], mode:'insensitive' }  -> LOWER(col) IN (...)  -> lower() btree
--   { contains: x, mode:'insensitive'} -> col ILIKE '%x%'      -> pg_trgm GIN
CREATE INDEX IF NOT EXISTS "Account_lower_country_idx" ON "Account"(LOWER("country"));
CREATE INDEX IF NOT EXISTS "Account_lower_state_idx" ON "Account"(LOWER("state"));
CREATE INDEX IF NOT EXISTS "Account_lower_industry_idx" ON "Account"(LOWER("industry"));
CREATE INDEX IF NOT EXISTS "Account_lower_city_idx" ON "Account"(LOWER("city"));
CREATE INDEX IF NOT EXISTS "Account_domain_trgm_idx" ON "Account" USING gin ("domain" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Account_linkedin_trgm_idx" ON "Account" USING gin ("linkedinUrl" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Account_industry_trgm_idx" ON "Account" USING gin ("industry" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Account_ticker_trgm_idx" ON "Account" USING gin ("ticker" gin_trgm_ops);
