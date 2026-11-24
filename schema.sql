-- مرجع فقط — الـ Worker بينفّذ نفس الجمل تلقائي (ensureSchema · CREATE IF NOT EXISTS) أول طلب.
-- D1 Console: جملة واحدة في سطر بلا `--` (ecommoda-constants §8) — الملف ده للقراءة مش للصق.
-- 🔴 عقد القراءة (CLAUDE.md): courier_profiles و courier_photos قراءة بس للأدوات التانية.
--    courier_sensitive و courier_pin_attempts: courier-names-worker وحده.

CREATE TABLE IF NOT EXISTS courier_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'person',      -- person | company | showroom
  status TEXT NOT NULL DEFAULT 'active',    -- active | removed (soft)
  phone_primary TEXT, phone_secondary TEXT,
  extra TEXT,                               -- JSON
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, created_by TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_courier_profiles_status ON courier_profiles(status);
CREATE TABLE IF NOT EXISTS courier_photos (
  courier_id INTEGER PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, bytes INTEGER NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS courier_sensitive (
  courier_id INTEGER PRIMARY KEY, national_id TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS courier_pin_attempts (
  username TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, window_start TEXT, locked_until TEXT
);
