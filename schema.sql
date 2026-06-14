-- Wane platform — full PostgreSQL schema (production-oriented)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TYPE user_role       AS ENUM ('ADMIN','TEACHER','STUDENT','RESEARCHER');
CREATE TYPE progress_status AS ENUM ('LOCKED','UNLOCKED','COMPLETED');
CREATE TYPE tx_type         AS ENUM ('SUBSCRIPTION','PAYOUT','SHARE_DISTRIBUTION','REFUND','TOPUP');
CREATE TYPE exam_section    AS ENUM ('READING','WRITING','SPEAKING');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(255) NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'STUDENT',
  ui_lang VARCHAR(12) NOT NULL DEFAULT 'ckb',
  dialect VARCHAR(12) NOT NULL DEFAULT 'ckb',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE levels_and_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  titles JSONB NOT NULL DEFAULT '{}',
  dialect VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL,
  parent_id UUID REFERENCES levels_and_units(id) ON DELETE SET NULL,
  UNIQUE (dialect, sort_order)
);

CREATE TABLE gateway_exams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level_id UUID NOT NULL REFERENCES levels_and_units(id) ON DELETE CASCADE,
  passing_score INT NOT NULL DEFAULT 80 CHECK (passing_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE question_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level_id UUID NOT NULL REFERENCES levels_and_units(id) ON DELETE CASCADE,
  section exam_section NOT NULL,
  dialect VARCHAR(50) NOT NULL,
  prompt TEXT NOT NULL,
  options JSONB,
  answer_idx INT,
  weight INT NOT NULL DEFAULT 1 CHECK (weight >= 1),
  reference_audio_url VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES levels_and_units(id) ON DELETE CASCADE,
  status progress_status NOT NULL DEFAULT 'LOCKED',
  best_score INT CHECK (best_score BETWEEN 0 AND 100),
  attempts INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE exam_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_id UUID NOT NULL REFERENCES levels_and_units(id) ON DELETE CASCADE,
  reading INT, writing INT, speaking INT, total INT,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  type tx_type NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kyc_verification (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_card_number VARCHAR(100) NOT NULL,
  passport_image_url VARCHAR(512),
  phone_number VARCHAR(50) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inheritance_beneficiaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_name VARCHAR(255) NOT NULL,
  relationship VARCHAR(100) NOT NULL,
  share_percentage NUMERIC(5,2) NOT NULL CHECK (share_percentage > 0 AND share_percentage <= 100),
  payout_start_date TIMESTAMPTZ,
  payout_end_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_grammar_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dialect VARCHAR(50) NOT NULL,
  rule_text TEXT NOT NULL,
  examples JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE phonetics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  grapheme VARCHAR(8) NOT NULL,
  dialect VARCHAR(50) NOT NULL,
  audio_url VARCHAR(512),
  tip TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  duration_min INT NOT NULL DEFAULT 45,
  join_url VARCHAR(512),
  external_id VARCHAR(255),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE semantic_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept VARCHAR(255) NOT NULL
);
CREATE TABLE semantic_words (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES semantic_groups(id) ON DELETE CASCADE,
  dialect VARCHAR(50) NOT NULL,
  word VARCHAR(255) NOT NULL
);

CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash_id VARCHAR(64) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  scores JSONB NOT NULL,
  pdf_url VARCHAR(512),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  op VARCHAR(60) NOT NULL,
  payload JSONB,
  client_ts TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_progress ON user_progress(user_id, status);
CREATE INDEX idx_levels_order ON levels_and_units(dialect, sort_order);
CREATE INDEX idx_tx_wallet ON financial_transactions(wallet_id, created_at);
CREATE INDEX idx_rules_dialect ON ai_grammar_rules(dialect);
CREATE INDEX idx_qb_level ON question_bank(level_id, section);
CREATE INDEX idx_cert_hash ON certificates(hash_id);
CREATE INDEX idx_semwords ON semantic_words(group_id);

-- Accredited certificate exam scheduling (online proctored or on-site)
CREATE TYPE exam_mode AS ENUM ('ONLINE','ONSITE');
CREATE TABLE exam_centers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  city VARCHAR(120),
  address TEXT
);
CREATE TABLE exam_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level_id UUID REFERENCES levels_and_units(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  mode exam_mode NOT NULL DEFAULT 'ONLINE',
  center_id UUID REFERENCES exam_centers(id) ON DELETE SET NULL,
  seats INT NOT NULL DEFAULT 10 CHECK (seats > 0),
  booked INT NOT NULL DEFAULT 0 CHECK (booked >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (booked <= seats)
);
CREATE TABLE exam_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES exam_slots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode exam_mode NOT NULL,
  join_url VARCHAR(512),      -- for ONLINE proctored sessions
  center_id UUID REFERENCES exam_centers(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'BOOKED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, user_id)
);
CREATE INDEX idx_slots_time ON exam_slots(starts_at);
CREATE INDEX idx_bookings_user ON exam_bookings(user_id);

-- Agent role + digital balance cards (vouchers) + agent applications
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AGENT';
ALTER TABLE ai_grammar_rules ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TYPE voucher_status AS ENUM ('ACTIVE','SOLD','REDEEMED','VOID');
CREATE TABLE vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) UNIQUE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status voucher_status NOT NULL DEFAULT 'ACTIVE',
  owner_agent UUID REFERENCES users(id) ON DELETE SET NULL,  -- allocated to agent
  buyer VARCHAR(255),
  redeemed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMPTZ
);
CREATE INDEX idx_voucher_code ON vouchers(code);
CREATE INDEX idx_voucher_agent ON vouchers(owner_agent);

CREATE TYPE application_status AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TABLE agent_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  region VARCHAR(120),
  status application_status NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Account suspension (with reason)
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspend_reason TEXT;

-- Admin treasury: balance funds the printing of digital cards
CREATE TABLE platform_treasury (
  id INT PRIMARY KEY DEFAULT 1,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  issued_cents  BIGINT NOT NULL DEFAULT 0,
  CHECK (id = 1)
);
INSERT INTO platform_treasury (id, balance_cents) VALUES (1, 0) ON CONFLICT DO NOTHING;

-- Agency license + two-party signed agreement
CREATE TABLE agency_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms TEXT NOT NULL,
  admin_signed BOOLEAN NOT NULL DEFAULT TRUE,
  agent_signed BOOLEAN NOT NULL DEFAULT FALSE,
  admin_signed_at TIMESTAMPTZ DEFAULT now(),
  agent_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id)
);

-- Rule review fields: admin vision + edit reason + clarification loop
ALTER TABLE ai_grammar_rules ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE ai_grammar_rules ADD COLUMN IF NOT EXISTS edit_reason TEXT;
ALTER TABLE ai_grammar_rules ADD COLUMN IF NOT EXISTS clarify_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_grammar_rules ADD COLUMN IF NOT EXISTS author_explanation TEXT;

-- Courses, enrollments, sales (platform takes a commission)
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TYPE enrollment_status AS ENUM ('PENDING','ACCEPTED','CONFIRMED','REJECTED');
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status enrollment_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, student_id)
);
CREATE TABLE course_sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL,
  commission_cents BIGINT NOT NULL,
  method VARCHAR(10) NOT NULL DEFAULT 'wallet',  -- wallet | cash
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Teacher onboarding (professional file + certificates) and subjects
ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject VARCHAR(40);

CREATE TABLE teacher_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  subjects JSONB NOT NULL DEFAULT '[]',
  bio TEXT,
  experience TEXT,
  certificates JSONB NOT NULL DEFAULT '[]',   -- [{name, path}] uploaded files
  status application_status NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exam committees: admin-formed groups of teachers that author the official exam bank
CREATE TABLE exam_committees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  dialect VARCHAR(10) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE committee_members (
  committee_id UUID NOT NULL REFERENCES exam_committees(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (committee_id, teacher_id)
);
CREATE TYPE exam_q_status AS ENUM ('PROPOSED','APPROVED','REJECTED');
CREATE TABLE exam_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  committee_id UUID NOT NULL REFERENCES exam_committees(id) ON DELETE CASCADE,
  dialect VARCHAR(10) NOT NULL,
  prompt TEXT NOT NULL,
  options JSONB NOT NULL,
  answer_index INT NOT NULL,
  marks INT NOT NULL DEFAULT 5,
  status exam_q_status NOT NULL DEFAULT 'PROPOSED',
  ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  author_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Course assessments (teacher-authored, auto-graded)
CREATE TABLE course_quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  questions JSONB NOT NULL,        -- [{q, options[], answer, marks}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id UUID NOT NULL REFERENCES course_quizzes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INT NOT NULL,
  total INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_id)
);
