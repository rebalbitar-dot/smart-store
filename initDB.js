const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const dbDir = './backend_data';
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const dbPath = path.join(dbDir, 'database.db');

// reset database to apply fresh schema
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Creating DB...");

    // core tables
    db.run("CREATE TABLE users (user_id INTEGER PRIMARY KEY, age INTEGER, country TEXT)");
    db.run("CREATE TABLE products (product_id INTEGER PRIMARY KEY, category TEXT, price REAL)");

    // prevents duplicate interactions per user-product pair
    db.run("CREATE TABLE behavior_15500 (user_id INTEGER, product_id INTEGER, viewed INTEGER, clicked INTEGER, purchased INTEGER, UNIQUE(user_id, product_id))");
    db.run("CREATE TABLE ratings (user_id INTEGER, product_id INTEGER, rating INTEGER, UNIQUE(user_id, product_id))");

    function importXLSX(fileName, insertSQL, mapFn) {
        const filePath = path.join(__dirname, 'data', fileName);

        if (!fs.existsSync(filePath)) {
            console.log(`Missing ${fileName}`);
            return;
        }

        const workbook = XLSX.readFile(filePath);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        // batch insert for better performance
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(insertSQL);

        data.forEach(row => {
            const cleanRow = {};
            for (let key in row) {
                cleanRow[key.trim().toLowerCase()] = row[key];
            }

            try {
                stmt.run(mapFn(cleanRow));
            } catch (e) {}
        });

        stmt.finalize();

        // commit all data at once
        db.run("COMMIT");

        console.log(`Imported ${fileName}`);
    }

    importXLSX('users.xlsx',
        "INSERT OR IGNORE INTO users VALUES (?,?,?)",
        r => [r.user_id, r.age, r.country ? String(r.country).trim().toLowerCase() : '']);

    importXLSX('products.xlsx',
        "INSERT OR IGNORE INTO products VALUES (?,?,?)",
        r => [r.product_id, r.category, r.price]);

    importXLSX('behavior_15500.xlsx',
        "INSERT OR IGNORE INTO behavior_15500 VALUES (?,?,?,?,?)",
        r => [r.user_id, r.product_id, parseInt(r.viewed) || 0, parseInt(r.clicked) || 0, parseInt(r.purchased) || 0]);

    importXLSX('ratings.xlsx',
        "INSERT OR IGNORE INTO ratings VALUES (?,?,?)",
        r => [r.user_id, r.product_id, parseInt(r.rating) || 0]);
});

// close database after import completes
db.close((err) => {
    if (err) console.error("Error closing DB:", err.message);
    else console.log("Database ready");
});