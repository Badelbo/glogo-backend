require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const { pool } = require("./database");
const bcrypt   = require("bcryptjs");
const { v4: uuid } = require("uuid");

async function seed() {
  const client = await pool.connect();
  console.log("🌱 Seeding Ghana data...\n");
  try {
    await client.query("BEGIN");

    // Stops
    const stopRows = [
      { name: "Kejetia Terminal",     lat: 6.6931, lng: -1.6248 },
      { name: "Adum Circle",          lat: 6.6905, lng: -1.6194 },
      { name: "Tech Junction",        lat: 6.6744, lng: -1.5714 },
      { name: "Santasi Roundabout",   lat: 6.6690, lng: -1.6401 },
      { name: "Bantama Station",      lat: 6.7102, lng: -1.6261 },
      { name: "Asafo Market",         lat: 6.6854, lng: -1.6078 },
    ];
    const stopIds = {};
    for (const s of stopRows) {
      const id = uuid();
      await client.query(
        `INSERT INTO stops (id,name,lat,lng) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, s.name, s.lat, s.lng]
      );
      stopIds[s.name] = id;
      console.log(`  📍 ${s.name}`);
    }

    const hash12 = (pw) => bcrypt.hash(pw, 12);

    // Admin
    const adminId = uuid();
    await client.query(
      `INSERT INTO users (id,phone,name,email,password_hash,role,is_verified)
       VALUES ($1,'0244000001','Glogo Admin','admin@glogo.gh',$2,'admin',TRUE) ON CONFLICT DO NOTHING`,
      [adminId, await hash12("admin123")]
    );
    console.log("\n  👤 Admin: 0244000001 / admin123");

    // Drivers
    const driverData = [
      { phone:"0244100001", name:"Kwame Asante",  license:"GH-DL-001234" },
      { phone:"0244100002", name:"Abena Mensah",  license:"GH-DL-001235" },
      { phone:"0244100003", name:"Kofi Boateng",  license:"GH-DL-001236" },
      { phone:"0244100004", name:"Ama Serwaa",    license:"GH-DL-001237" },
    ];
    const driverHash = await hash12("driver123");
    const driverIds = [];
    for (const d of driverData) {
      const uid = uuid(); const did = uuid();
      await client.query(
        `INSERT INTO users (id,phone,name,password_hash,role,is_verified)
         VALUES ($1,$2,$3,$4,'driver',TRUE) ON CONFLICT DO NOTHING`,
        [uid, d.phone, d.name, driverHash]
      );
      await client.query(
        `INSERT INTO drivers (id,user_id,license_number,license_expiry,is_verified)
         VALUES ($1,$2,$3,'2027-12-31',TRUE) ON CONFLICT DO NOTHING`,
        [did, uid, d.license]
      );
      driverIds.push(did);
      console.log(`  🚗 Driver: ${d.name}`);
    }

    // Vehicles
    const vehicles = [
      { code:"KSI-001", plate:"AS-1234-23", type:"trotro",    cap:18, route:"Kejetia → Tech Junction", fare:2.50, di:0 },
      { code:"KSI-002", plate:"AS-5678-23", type:"trotro",    cap:18, route:"Adum → Santasi",          fare:2.00, di:1 },
      { code:"KSI-003", plate:"AS-9012-22", type:"metro_bus", cap:35, route:"Santasi → Kejetia",       fare:3.00, di:2 },
      { code:"KSI-004", plate:"AS-3456-23", type:"trotro",    cap:14, route:"Tech Junction → Adum",    fare:1.50, di:3 },
    ];
    for (const v of vehicles) {
      await client.query(
        `INSERT INTO vehicles (id,vehicle_code,type,plate_number,capacity,driver_id,route_name,fare,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'idle') ON CONFLICT DO NOTHING`,
        [uuid(), v.code, v.type, v.plate, v.cap, driverIds[v.di], v.route, v.fare]
      );
      console.log(`  🚌 Vehicle: ${v.code} — ${v.route}`);
    }

    // Test commuter
    await client.query(
      `INSERT INTO users (id,phone,name,email,password_hash,role,is_verified)
       VALUES ($1,'0244200001','Test Commuter','user@glogo.gh',$2,'commuter',TRUE) ON CONFLICT DO NOTHING`,
      [uuid(), await hash12("test123")]
    );
    console.log("\n  👤 Commuter: 0244200001 / test123");
    console.log("  🔑 All drivers: password = driver123");

    await client.query("COMMIT");
    console.log("\n🎉 Seed complete!\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
