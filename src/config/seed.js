require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const { pool } = require("./database");
const bcrypt   = require("bcryptjs");
const { v4: uuid } = require("uuid");

const ALL_STOPS = [
  // GREATER ACCRA
  { name:"Accra Central (Circle)",        city:"Accra",         region:"Greater Accra",  lat:5.5560, lng:-0.2070 },
  { name:"Kwame Nkrumah Circle",          city:"Accra",         region:"Greater Accra",  lat:5.5620, lng:-0.2080 },
  { name:"Kaneshie Market Terminal",      city:"Accra",         region:"Greater Accra",  lat:5.5710, lng:-0.2320 },
  { name:"Tema Station",                  city:"Accra",         region:"Greater Accra",  lat:5.5480, lng:-0.2010 },
  { name:"Tudu Bus Terminal",             city:"Accra",         region:"Greater Accra",  lat:5.5490, lng:-0.2050 },
  { name:"37 Military Hospital Junction", city:"Accra",         region:"Greater Accra",  lat:5.5870, lng:-0.1850 },
  { name:"Madina Terminal",               city:"Accra",         region:"Greater Accra",  lat:5.6740, lng:-0.1660 },
  { name:"Achimota Terminal",             city:"Accra",         region:"Greater Accra",  lat:5.6140, lng:-0.2280 },
  { name:"Kasoa Junction",                city:"Kasoa",         region:"Greater Accra",  lat:5.5330, lng:-0.4230 },
  { name:"Lapaz Terminal",                city:"Accra",         region:"Greater Accra",  lat:5.6100, lng:-0.2490 },
  { name:"Neoplan Station",               city:"Accra",         region:"Greater Accra",  lat:5.5560, lng:-0.1960 },
  { name:"Ashaiman Terminal",             city:"Ashaiman",      region:"Greater Accra",  lat:5.6960, lng:-0.0330 },
  { name:"Tema Community 1",              city:"Tema",          region:"Greater Accra",  lat:5.6698, lng:-0.0166 },
  { name:"Tema Main Harbour Junction",    city:"Tema",          region:"Greater Accra",  lat:5.6472, lng:-0.0164 },
  { name:"Dansoman Terminal",             city:"Accra",         region:"Greater Accra",  lat:5.5340, lng:-0.2600 },
  { name:"Legon Campus Junction",         city:"Accra",         region:"Greater Accra",  lat:5.6502, lng:-0.1869 },
  { name:"East Legon Junction",           city:"Accra",         region:"Greater Accra",  lat:5.6357, lng:-0.1564 },
  { name:"Accra Airport Junction",        city:"Accra",         region:"Greater Accra",  lat:5.6052, lng:-0.1668 },
  { name:"Abeka Lapaz",                   city:"Accra",         region:"Greater Accra",  lat:5.5960, lng:-0.2560 },
  { name:"Odorkor Terminal",              city:"Accra",         region:"Greater Accra",  lat:5.5720, lng:-0.2720 },
  // ASHANTI
  { name:"Kejetia Terminal",              city:"Kumasi",        region:"Ashanti",         lat:6.6931, lng:-1.6248 },
  { name:"Adum Circle",                   city:"Kumasi",        region:"Ashanti",         lat:6.6905, lng:-1.6194 },
  { name:"Tech Junction (KNUST)",         city:"Kumasi",        region:"Ashanti",         lat:6.6744, lng:-1.5714 },
  { name:"Santasi Roundabout",            city:"Kumasi",        region:"Ashanti",         lat:6.6690, lng:-1.6401 },
  { name:"Bantama Station",               city:"Kumasi",        region:"Ashanti",         lat:6.7102, lng:-1.6261 },
  { name:"Asafo Market",                  city:"Kumasi",        region:"Ashanti",         lat:6.6854, lng:-1.6078 },
  { name:"Suame Magazine Junction",       city:"Kumasi",        region:"Ashanti",         lat:6.7200, lng:-1.6120 },
  { name:"Asokwa Terminal",               city:"Kumasi",        region:"Ashanti",         lat:6.6670, lng:-1.6050 },
  { name:"Tafo Junction",                 city:"Kumasi",        region:"Ashanti",         lat:6.7290, lng:-1.6080 },
  { name:"Ejisu Junction",                city:"Ejisu",         region:"Ashanti",         lat:6.7060, lng:-1.4750 },
  { name:"Obuasi Station",                city:"Obuasi",        region:"Ashanti",         lat:6.2050, lng:-1.6680 },
  { name:"Mampong Station",               city:"Mampong",       region:"Ashanti",         lat:7.0610, lng:-1.4010 },
  // WESTERN
  { name:"Takoradi Market Circle",        city:"Takoradi",      region:"Western",         lat:4.8845, lng:-1.7554 },
  { name:"Takoradi Harbour Junction",     city:"Takoradi",      region:"Western",         lat:4.8830, lng:-1.7620 },
  { name:"Sekondi Station",               city:"Sekondi",       region:"Western",         lat:4.9430, lng:-1.7050 },
  { name:"Tarkwa Station",                city:"Tarkwa",        region:"Western",         lat:5.3010, lng:-1.9940 },
  { name:"Axim Junction",                 city:"Axim",          region:"Western",         lat:4.8690, lng:-2.2370 },
  { name:"Bogoso Junction",               city:"Bogoso",        region:"Western",         lat:5.5330, lng:-2.0720 },
  { name:"Sefwi Wiawso Station",          city:"Sefwi Wiawso",  region:"Western",         lat:6.2080, lng:-2.4850 },
  // EASTERN
  { name:"Koforidua Central Terminal",    city:"Koforidua",     region:"Eastern",         lat:6.0940, lng:-0.2590 },
  { name:"Nkawkaw Station",               city:"Nkawkaw",       region:"Eastern",         lat:6.5530, lng:-0.7610 },
  { name:"Suhum Station",                 city:"Suhum",         region:"Eastern",         lat:6.0430, lng:-0.4560 },
  { name:"Nsawam Station",                city:"Nsawam",        region:"Eastern",         lat:5.8040, lng:-0.3500 },
  { name:"Akim Oda Station",              city:"Akim Oda",      region:"Eastern",         lat:5.9270, lng:-0.9920 },
  { name:"Kwahu Nkwatia Junction",        city:"Kwahu",         region:"Eastern",         lat:6.6300, lng:-0.5100 },
  // CENTRAL
  { name:"Cape Coast Central",            city:"Cape Coast",    region:"Central",         lat:5.1050, lng:-1.2466 },
  { name:"Cape Coast Kotokuraba Market",  city:"Cape Coast",    region:"Central",         lat:5.1020, lng:-1.2500 },
  { name:"Winneba Station",               city:"Winneba",       region:"Central",         lat:5.3530, lng:-0.6250 },
  { name:"Saltpond Station",              city:"Saltpond",      region:"Central",         lat:5.2030, lng:-1.0620 },
  { name:"Mankessim Junction",            city:"Mankessim",     region:"Central",         lat:5.2650, lng:-1.0180 },
  { name:"Assin Fosu Station",            city:"Assin Fosu",    region:"Central",         lat:5.7000, lng:-1.2890 },
  { name:"Swedru Station",                city:"Swedru",        region:"Central",         lat:5.5340, lng:-0.7020 },
  // VOLTA
  { name:"Ho Central Terminal",           city:"Ho",            region:"Volta",           lat:6.6010, lng:0.4700 },
  { name:"Hohoe Station",                 city:"Hohoe",         region:"Volta",           lat:7.1520, lng:0.4740 },
  { name:"Keta Station",                  city:"Keta",          region:"Volta",           lat:5.9060, lng:0.9990 },
  { name:"Aflao Border Terminal",         city:"Aflao",         region:"Volta",           lat:6.1110, lng:1.1880 },
  { name:"Sogakope Station",              city:"Sogakope",      region:"Volta",           lat:5.8790, lng:0.5950 },
  { name:"Denu Station",                  city:"Denu",          region:"Volta",           lat:6.0650, lng:1.1610 },
  { name:"Kpando Station",                city:"Kpando",        region:"Volta",           lat:6.9990, lng:0.3010 },
  // BONO / BRONG-AHAFO
  { name:"Sunyani Central Terminal",      city:"Sunyani",       region:"Bono",            lat:7.3350, lng:-2.3260 },
  { name:"Techiman Station",              city:"Techiman",      region:"Bono East",       lat:7.5910, lng:-1.9350 },
  { name:"Berekum Station",               city:"Berekum",       region:"Bono",            lat:7.4520, lng:-2.5860 },
  { name:"Dormaa Ahenkro Station",        city:"Dormaa Ahenkro",region:"Bono",            lat:7.2960, lng:-2.8480 },
  { name:"Kintampo Station",              city:"Kintampo",      region:"Bono East",       lat:8.0590, lng:-1.7290 },
  { name:"Wenchi Station",                city:"Wenchi",        region:"Bono",            lat:7.7460, lng:-2.1000 },
  { name:"Atebubu Station",               city:"Atebubu",       region:"Bono East",       lat:7.7530, lng:-0.9850 },
  // NORTHERN
  { name:"Tamale Central Terminal",       city:"Tamale",        region:"Northern",        lat:9.4008, lng:-0.8393 },
  { name:"Tamale STC Station",            city:"Tamale",        region:"Northern",        lat:9.4050, lng:-0.8410 },
  { name:"Tamale Aboabo Station",         city:"Tamale",        region:"Northern",        lat:9.3920, lng:-0.8520 },
  { name:"Yendi Station",                 city:"Yendi",         region:"Northern",        lat:9.4430, lng:-0.0080 },
  { name:"Salaga Station",                city:"Salaga",        region:"Savannah",        lat:8.5560, lng:-0.5140 },
  { name:"Bole Station",                  city:"Bole",          region:"Savannah",        lat:9.0280, lng:-2.4890 },
  // UPPER EAST
  { name:"Bolgatanga Central Terminal",   city:"Bolgatanga",    region:"Upper East",      lat:10.7860,lng:-0.8510 },
  { name:"Navrongo Station",              city:"Navrongo",      region:"Upper East",      lat:10.8940,lng:-1.0950 },
  { name:"Bawku Station",                 city:"Bawku",         region:"Upper East",      lat:11.0600,lng:-0.2430 },
  { name:"Paga Border Terminal",          city:"Paga",          region:"Upper East",      lat:10.9860,lng:-1.1120 },
  // UPPER WEST
  { name:"Wa Central Terminal",           city:"Wa",            region:"Upper West",      lat:10.0604,lng:-2.5099 },
  { name:"Lawra Station",                 city:"Lawra",         region:"Upper West",      lat:10.6540,lng:-2.8960 },
  { name:"Nandom Station",                city:"Nandom",        region:"Upper West",      lat:10.8560,lng:-2.7650 },
  { name:"Hamile Border Terminal",        city:"Hamile",        region:"Upper West",      lat:10.9270,lng:-2.7900 },
  { name:"Tumu Station",                  city:"Tumu",          region:"Upper West",      lat:10.9040,lng:-1.9990 },
  // OTI
  { name:"Dambai Station",                city:"Dambai",        region:"Oti",             lat:8.0690, lng:0.1780 },
  { name:"Nkwanta Station",               city:"Nkwanta",       region:"Oti",             lat:8.2890, lng:0.1060 },
  // AHAFO
  { name:"Goaso Station",                 city:"Goaso",         region:"Ahafo",           lat:6.8020, lng:-2.5130 },
  // NORTH EAST
  { name:"Nalerigu Station",              city:"Nalerigu",      region:"North East",      lat:10.5260,lng:-0.3620 },
  { name:"Gambaga Station",               city:"Gambaga",       region:"North East",      lat:10.5230,lng:-0.4380 },
  // SAVANNAH
  { name:"Damongo Station",               city:"Damongo",       region:"Savannah",        lat:9.0830, lng:-1.8240 },
  // WESTERN NORTH
  { name:"Bibiani Station",               city:"Bibiani",       region:"Western North",   lat:6.4640, lng:-2.3310 },
  { name:"Sefwi Bekwai Station",          city:"Sefwi Bekwai",  region:"Western North",   lat:6.3310, lng:-2.3280 },
];

const VEHICLES = [
  { code:"ACC-001", plate:"GR-1001-24", type:"metro_bus", cap:35, route:"Circle → Achimota",       fare:3.00 },
  { code:"ACC-002", plate:"GR-1002-24", type:"trotro",    cap:18, route:"Kaneshie → Tema Station",  fare:2.50 },
  { code:"ACC-003", plate:"GR-1003-24", type:"trotro",    cap:18, route:"Madina → Circle",          fare:2.50 },
  { code:"ACC-004", plate:"GR-1004-24", type:"trotro",    cap:14, route:"Lapaz → Tudu",             fare:2.00 },
  { code:"ACC-005", plate:"GR-1005-24", type:"metro_bus", cap:35, route:"Accra → Tema",             fare:4.00 },
  { code:"KSI-001", plate:"AS-1234-23", type:"trotro",    cap:18, route:"Kejetia → Tech Junction",  fare:2.50 },
  { code:"KSI-002", plate:"AS-5678-23", type:"trotro",    cap:18, route:"Adum → Santasi",           fare:2.00 },
  { code:"KSI-003", plate:"AS-9012-22", type:"metro_bus", cap:35, route:"Santasi → Kejetia",        fare:3.00 },
  { code:"KSI-004", plate:"AS-3456-23", type:"trotro",    cap:14, route:"Tech Junction → Bantama",  fare:1.50 },
  { code:"TKD-001", plate:"WR-2001-24", type:"trotro",    cap:18, route:"Market Circle → Harbour",  fare:2.00 },
  { code:"TKD-002", plate:"WR-2002-24", type:"trotro",    cap:14, route:"Takoradi → Sekondi",       fare:2.00 },
  { code:"CPC-001", plate:"CR-3001-24", type:"trotro",    cap:18, route:"Central → Kotokuraba",     fare:1.50 },
  { code:"CPC-002", plate:"CR-3002-24", type:"trotro",    cap:14, route:"Cape Coast → Winneba",     fare:3.00 },
  { code:"TML-001", plate:"NR-4001-24", type:"metro_bus", cap:35, route:"Central → Aboabo",         fare:2.00 },
  { code:"TML-002", plate:"NR-4002-24", type:"trotro",    cap:18, route:"Tamale → Yendi",           fare:5.00 },
  { code:"KFD-001", plate:"ER-5001-24", type:"trotro",    cap:18, route:"Koforidua → Nsawam",       fare:3.00 },
  { code:"HO--001", plate:"VR-6001-24", type:"trotro",    cap:18, route:"Ho → Hohoe",               fare:4.00 },
  { code:"BLG-001", plate:"UE-7001-24", type:"trotro",    cap:18, route:"Bolga → Navrongo",         fare:3.00 },
  { code:"BLG-002", plate:"UE-7002-24", type:"trotro",    cap:14, route:"Bolga → Bawku",            fare:5.00 },
  { code:"WA--001", plate:"UW-8001-24", type:"trotro",    cap:18, route:"Wa → Lawra",               fare:4.00 },
  { code:"SNY-001", plate:"BR-9001-24", type:"trotro",    cap:18, route:"Sunyani → Techiman",       fare:3.00 },
];

const DRIVERS = [
  { phone:"0244100001", name:"Kwame Asante",    license:"GH-DL-001234" },
  { phone:"0244100002", name:"Abena Mensah",    license:"GH-DL-001235" },
  { phone:"0244100003", name:"Kofi Boateng",    license:"GH-DL-001236" },
  { phone:"0244100004", name:"Ama Serwaa",      license:"GH-DL-001237" },
  { phone:"0244100005", name:"Yaw Darko",       license:"GH-DL-001238" },
  { phone:"0244100006", name:"Akosua Frimpong", license:"GH-DL-001239" },
  { phone:"0244100007", name:"Kojo Mensah",     license:"GH-DL-001240" },
  { phone:"0244100008", name:"Adjoa Boateng",   license:"GH-DL-001241" },
];

async function seed() {
  const client = await pool.connect();
  console.log("Seeding all Ghana cities...\n");
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM queue_entries");
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM notifications");
    await client.query("DELETE FROM trips");
    await client.query("DELETE FROM vehicles");
    await client.query("DELETE FROM drivers");
    await client.query("DELETE FROM stops");
    await client.query("DELETE FROM users WHERE role != 'admin'");
    console.log("  Cleared old data");

    for (const s of ALL_STOPS) {
      await client.query(
        `INSERT INTO stops (id,name,city,region,lat,lng) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uuid(), s.name, s.city, s.region, s.lat, s.lng]
      );
    }
    const cities = [...new Set(ALL_STOPS.map(s => s.city))];
    console.log(`  ${ALL_STOPS.length} stops | ${cities.length} cities added`);

    const adminExists = await client.query("SELECT id FROM users WHERE phone='0244000001'");
    if (!adminExists.rows[0]) {
      await client.query(
        `INSERT INTO users (id,phone,name,email,password_hash,role,is_verified) VALUES ($1,'0244000001','Glogo Admin','admin@glogo.gh',$2,'admin',TRUE)`,
        [uuid(), await bcrypt.hash("admin123",12)]
      );
    }

    const dh = await bcrypt.hash("driver123",12);
    const dids = [];
    for (const d of DRIVERS) {
      const uid=uuid(), did=uuid();
      await client.query(
        `INSERT INTO users (id,phone,name,password_hash,role,is_verified) VALUES ($1,$2,$3,$4,'driver',TRUE) ON CONFLICT DO NOTHING`,
        [uid, d.phone, d.name, dh]
      );
      await client.query(
        `INSERT INTO drivers (id,user_id,license_number,license_expiry,is_verified) VALUES ($1,$2,$3,'2027-12-31',TRUE) ON CONFLICT DO NOTHING`,
        [did, uid, d.license]
      );
      dids.push(did);
    }
    console.log(`  ${DRIVERS.length} drivers added`);

    for (let i=0; i<VEHICLES.length; i++) {
      const v=VEHICLES[i];
      await client.query(
        `INSERT INTO vehicles (id,vehicle_code,type,plate_number,capacity,driver_id,route_name,fare,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'idle') ON CONFLICT DO NOTHING`,
        [uuid(), v.code, v.type, v.plate, v.cap, dids[i%dids.length], v.route, v.fare]
      );
    }
    console.log(`  ${VEHICLES.length} vehicles added`);

    const ce = await client.query("SELECT id FROM users WHERE phone='0244200001'");
    if (!ce.rows[0]) {
      await client.query(
        `INSERT INTO users (id,phone,name,email,password_hash,role,is_verified) VALUES ($1,'0244200001','Test Commuter','user@glogo.gh',$2,'commuter',TRUE)`,
        [uuid(), await bcrypt.hash("test123",12)]
      );
    }

    await client.query("COMMIT");
    console.log(`\nSeed complete! ${ALL_STOPS.length} stops across ${cities.length} cities in Ghana.\n`);
  } catch(err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(()=>process.exit(1));
