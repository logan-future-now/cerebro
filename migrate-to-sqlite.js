#!/usr/bin/env node
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = './tasks.db';
const JSON_PATH = './tasks.json';
const BACKUP_PATH = `./tasks.json.pre-sqlite.${Date.now()}`;

console.log('🔄 Migrating Cerebro from JSON to SQLite...\n');

// Read existing tasks
console.log(`📖 Reading ${JSON_PATH}...`);
const tasks = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
console.log(`   Found ${tasks.length} tasks\n`);

// Create database
console.log(`🗄️  Creating ${DB_PATH}...`);
const db = new sqlite3.Database(DB_PATH);

// Read and execute schema
const schema = fs.readFileSync('./schema.sql', 'utf8');
db.exec(schema, (err) => {
  if (err) {
    console.error('❌ Schema creation failed:', err);
    process.exit(1);
  }
  
  console.log('   Schema created\n');
  
  // Insert tasks
  console.log('📥 Importing tasks...');
  const stmt = db.prepare(`
    INSERT INTO tasks (id, title, desc, column_name, project, priority, created, trashed, trashed_from, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let imported = 0;
  tasks.forEach(task => {
    stmt.run(
      task.id,
      task.title,
      task.desc || null,
      task.column || 'Backlog',  // 'column' in JSON, 'column_name' in DB
      task.project || 'General',
      task.priority || 'medium',
      task.created || Date.now(),
      task.trashed ? 1 : 0,
      task.trashedFrom || null,
      Date.now()
    );
    imported++;
  });
  
  stmt.finalize((err) => {
    if (err) {
      console.error('❌ Import failed:', err);
      process.exit(1);
    }
    
    console.log(`   Imported ${imported} tasks\n`);
    
    // Backup JSON file
    console.log(`💾 Backing up ${JSON_PATH} to ${BACKUP_PATH}...`);
    fs.copyFileSync(JSON_PATH, BACKUP_PATH);
    
    // Verify
    db.get('SELECT COUNT(*) as count FROM tasks', (err, row) => {
      if (err) {
        console.error('❌ Verification failed:', err);
        process.exit(1);
      }
      
      console.log(`\n✅ Migration complete!`);
      console.log(`   Database: ${DB_PATH}`);
      console.log(`   Tasks in DB: ${row.count}`);
      console.log(`   JSON backup: ${BACKUP_PATH}`);
      console.log(`\n💡 Next: Restart cerebro service to use the new database`);
      
      db.close();
    });
  });
});
