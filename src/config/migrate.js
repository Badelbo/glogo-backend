require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const { pool } = require("./database");

const SQL = `
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types (safe re-run)
DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('commuter','driver','admin','stop_manager');
  CREATE TYPE vehicle_type   AS ENUM ('trotro','metro_bus','mini_bus','taxi');
  CREATE TYPE vehicle_status AS ENUM ('idle','loading','en_route','full','offline','maintenance');
  CREATE TYPE queue_status   AS ENUM ('waiting','ready','boarding','boarded','cancelled','no_show');
  CREATE TYPE payment_status AS ENUM ('pending','processing','success','failed','refunded');
  CREATE TYPE payment_method AS ENUM ('mtn_momo','airtel_money','visa','mastercard','cash');
  CREATE TYPE trip_status    AS ENUM ('scheduled','active','completed','cancelled');
  CREATE TYPE notif_type     AS ENUM ('vehicle_arriving','queue_ready','payment_success','payment_failed','trip_update','system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone          VARCHAR(15) UNIQUE NOT NULL,
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(150) UNIQUE,
  password_hash  TEXT NOT NULL,
  role           user_role NOT NULL DEFAULT 'commuter',
  fcm_token      TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  is_verified    BOOLEAN DEFAULT FALSE,
  refresh_token  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Stops
CREATE TABLE IF NOT EXISTS stops (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  city        VARCHAR(80)  NOT NULL DEFAULT 'Kumasi',
  region      VARCHAR(80)  NOT NULL DEFAULT 'Ashanti',
  lat         DECIMAL(10,7) NOT NULL,
  lng         DECIMAL(10,7) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_number VARCHAR(30) UNIQUE NOT NULL,
  license_expiry DATE NOT NULL,
  is_verified    BOOLEAN DEFAULT FALSE,
  rating         DECIMAL(3,2) DEFAULT 5.00,
  total_trips    INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_code    VARCHAR(20) UNIQUE NOT NULL,
  type            vehicle_type NOT NULL DEFAULT 'trotro',
  plate_number    VARCHAR(15) UNIQUE NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 18,
  driver_id       UUID REFERENCES drivers(id) ON DELETE SET NULL,
  route_name      TEXT,
  status          vehicle_status NOT NULL DEFAULT 'idle',
  current_stop_id UUID REFERENCES stops(id) ON DELETE SET NULL,
  current_lat     DECIMAL(10,7),
  current_lng     DECIMAL(10,7),
  heading         DECIMAL(5,2),
  fare            DECIMAL(8,2) NOT NULL DEFAULT 2.50,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(driver_id);

-- Trips
CREATE TABLE IF NOT EXISTS trips (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id        UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  from_stop_id     UUID REFERENCES stops(id),
  to_stop_id       UUID REFERENCES stops(id),
  status           trip_status NOT NULL DEFAULT 'scheduled',
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  passengers_count INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Queue entries
CREATE TABLE IF NOT EXISTS queue_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  stop_id        UUID NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  trip_id        UUID REFERENCES trips(id) ON DELETE SET NULL,
  queue_number   INTEGER NOT NULL,
  status         queue_status NOT NULL DEFAULT 'waiting',
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  ready_at       TIMESTAMPTZ,
  boarded_at     TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  estimated_wait INTEGER,
  UNIQUE(vehicle_id, queue_number)
);
CREATE INDEX IF NOT EXISTS idx_queue_vehicle ON queue_entries(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_user    ON queue_entries(user_id, status);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queue_entry_id    UUID REFERENCES queue_entries(id) ON DELETE SET NULL,
  amount            DECIMAL(10,2) NOT NULL,
  currency          VARCHAR(5) NOT NULL DEFAULT 'GHS',
  method            payment_method NOT NULL,
  status            payment_status NOT NULL DEFAULT 'pending',
  provider_ref      TEXT,
  provider_response JSONB,
  phone_number      VARCHAR(15),
  description       TEXT,
  failed_reason     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     notif_type NOT NULL,
  title    VARCHAR(120) NOT NULL,
  body     TEXT NOT NULL,
  data     JSONB,
  is_read  BOOLEAN DEFAULT FALSE,
  sent_at  TIMESTAMPTZ DEFAULT NOW(),
  read_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at    ON users;
CREATE TRIGGER users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS vehicles_updated_at ON vehicles;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function migrate() {
  const client = await pool.connect();
  console.log("🚀 Running migrations...");
  try {
    await client.query(SQL);
    console.log("✅ All tables created successfully!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
