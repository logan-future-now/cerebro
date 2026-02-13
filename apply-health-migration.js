#!/usr/bin/env node
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'tasks.db');
const MIGRATION_PATH = path.join(__dirname, 'db/migrations/2026-02-11-health-checks.sql');

console.log('Applying health checks migration...');

const db = new sqlite3.Database(DB_PATH);
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

db.exec(migration, (err) => {
  if (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
  
  // Verify the tables were created
  db.all("SELECT id, name, host, port, health_path, enabled FROM services ORDER BY id", [], (err, rows) => {
    if (err) {
      console.error('Verification failed:', err);
      process.exit(1);
    }
    
    console.log('\n✅ Migration applied successfully!');
    console.log('\nSeeded services:');
    console.table(rows);
    
    db.close();
  });
});
