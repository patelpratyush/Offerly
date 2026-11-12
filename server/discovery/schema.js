// Shared DDL (SQLite dialect that is also valid PostgreSQL). Hosted databases
// receive the same statements from supabase/migrations; tests keep them in sync.
export const DISCOVERY_TABLES = [
  "discovery_companies",
  "discovery_sources",
  "discovery_jobs",
  "discovery_listings",
  "discovery_snapshots",
  "discovery_runs",
  "discovery_profiles",
  "discovery_user_jobs",
  "discovery_watchlist",
  "discovery_saved_searches",
  "discovery_alert_rules",
  "discovery_notifications",
];
export const DISCOVERY_DDL = `
CREATE TABLE IF NOT EXISTS discovery_companies(id TEXT PRIMARY KEY,canonical_domain TEXT NOT NULL UNIQUE,name TEXT NOT NULL,entity_label TEXT NOT NULL DEFAULT 'employer' CHECK(entity_label IN ('employer','subsidiary','parent')),entity_name TEXT NOT NULL DEFAULT '',size_min INTEGER CHECK(size_min IS NULL OR size_min>=1),size_max INTEGER CHECK(size_max IS NULL OR size_max>=1),size_source_url TEXT NOT NULL DEFAULT '',size_as_of TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discovery_sources(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES discovery_companies(id) ON DELETE CASCADE,platform TEXT NOT NULL CHECK(platform IN ('greenhouse','lever','ashby')),board_id TEXT NOT NULL,career_url TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0,permission_status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(permission_status IN ('unconfirmed','confirmed','revoked')),health TEXT NOT NULL DEFAULT 'unknown' CHECK(health IN ('unknown','healthy','degraded','failing')),last_success_at TEXT,last_attempt_at TEXT,next_fetch_at TEXT,consecutive_failures INTEGER NOT NULL DEFAULT 0,last_error_code TEXT NOT NULL DEFAULT '',listed_count INTEGER NOT NULL DEFAULT 0,UNIQUE(platform,board_id));
CREATE INDEX IF NOT EXISTS idx_disc_sources_company ON discovery_sources(company_id);
CREATE TABLE IF NOT EXISTS discovery_jobs(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES discovery_companies(id) ON DELETE CASCADE,title TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',requisition TEXT NOT NULL DEFAULT '',group_key TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',work_arrangement TEXT NOT NULL DEFAULT 'Unknown',employment_type TEXT NOT NULL DEFAULT 'Unknown',comp_min BIGINT,comp_max BIGINT,comp_currency TEXT NOT NULL DEFAULT '',comp_period TEXT NOT NULL DEFAULT 'Unknown',comp_basis TEXT NOT NULL DEFAULT 'Unknown',employer_posted_at TEXT,posted_precision TEXT NOT NULL DEFAULT 'unknown' CHECK(posted_precision IN ('unknown','date','datetime')),posted_timezone TEXT NOT NULL DEFAULT '',first_discovered_at TEXT NOT NULL,last_checked_at TEXT NOT NULL,last_changed_at TEXT NOT NULL,reopened_at TEXT,reopened_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'listed' CHECK(status IN ('listed','not_listed')),content_hash TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_disc_jobs_company ON discovery_jobs(company_id,group_key);
CREATE INDEX IF NOT EXISTS idx_disc_jobs_posted ON discovery_jobs(employer_posted_at);
CREATE INDEX IF NOT EXISTS idx_disc_jobs_discovered ON discovery_jobs(first_discovered_at);
CREATE TABLE IF NOT EXISTS discovery_listings(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,external_id TEXT NOT NULL,url TEXT NOT NULL,requisition TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'listed' CHECK(status IN ('listed','not_listed')),verification TEXT NOT NULL DEFAULT 'verified' CHECK(verification IN ('verified','could_not_verify')),first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,last_checked_at TEXT NOT NULL,content_hash TEXT NOT NULL DEFAULT '',UNIQUE(source_id,external_id));
CREATE INDEX IF NOT EXISTS idx_disc_listings_job ON discovery_listings(job_id);
CREATE TABLE IF NOT EXISTS discovery_snapshots(id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES discovery_listings(id) ON DELETE CASCADE,captured_at TEXT NOT NULL,content_hash TEXT NOT NULL,fields TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_disc_snapshots_listing ON discovery_snapshots(listing_id,captured_at);
CREATE TABLE IF NOT EXISTS discovery_runs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,started_at TEXT NOT NULL,finished_at TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','rejected','skipped')),listing_count INTEGER NOT NULL DEFAULT 0,error_code TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_disc_runs_source ON discovery_runs(source_id,started_at);
CREATE TABLE IF NOT EXISTS discovery_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,facts TEXT NOT NULL DEFAULT '{}',eligibility TEXT NOT NULL DEFAULT '{}',preferences TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,approved_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discovery_user_jobs(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,job_id TEXT NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,saved_at TEXT,dismissed_at TEXT,dismiss_reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,job_id));
CREATE TABLE IF NOT EXISTS discovery_watchlist(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,company_id TEXT NOT NULL REFERENCES discovery_companies(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,company_id));
CREATE TABLE IF NOT EXISTS discovery_saved_searches(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,filters TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_disc_searches_user ON discovery_saved_searches(user_id);
CREATE TABLE IF NOT EXISTS discovery_alert_rules(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,filters TEXT NOT NULL,min_fit INTEGER NOT NULL DEFAULT 0,include_unknown_eligibility INTEGER NOT NULL DEFAULT 0,watchlist_only INTEGER NOT NULL DEFAULT 0,paused INTEGER NOT NULL DEFAULT 0,quiet_start TEXT NOT NULL DEFAULT '',quiet_end TEXT NOT NULL DEFAULT '',daily_cap INTEGER NOT NULL DEFAULT 10,since TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_disc_rules_user ON discovery_alert_rules(user_id);
CREATE TABLE IF NOT EXISTS discovery_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,rule_id TEXT NOT NULL REFERENCES discovery_alert_rules(id) ON DELETE CASCADE,job_id TEXT NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,event TEXT NOT NULL CHECK(event IN ('new_job','reopened')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','suppressed')),suppress_reason TEXT NOT NULL DEFAULT '',payload TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,deliver_after TEXT NOT NULL,delivered_at TEXT,read_at TEXT,UNIQUE(user_id,rule_id,job_id,event));
CREATE INDEX IF NOT EXISTS idx_disc_notes_user ON discovery_notifications(user_id,status,created_at);
`;
export async function initializeDiscovery(store) {
  if (store.db.hosted) return; // Hosted schemas come from supabase/migrations.
  await store.db.exec(DISCOVERY_DDL);
}
