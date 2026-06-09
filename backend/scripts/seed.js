require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../src/db/pool');

(async () => {
  try {
    console.log('🌱 Seeding database...');

    // Clear existing data for a clean, repeatable seed
    await pool.query('TRUNCATE users, households, household_members, tasks, task_assignments, task_assignment_members, bills, bill_splits, purchases, purchase_contributions CASCADE');

    // Create demo users
    const hash = await bcrypt.hash('password123', 12);
    const users = [
      { id: uuidv4(), name: 'Alice', email: 'alice@demo.com' },
      { id: uuidv4(), name: 'Bob',   email: 'bob@demo.com'   },
      { id: uuidv4(), name: 'Carol', email: 'carol@demo.com' },
    ];

    for (const u of users) {
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [u.id, u.name, u.email, hash]
      );
    }

    // Create a demo household
    const householdId = uuidv4();
    await pool.query(
      'INSERT INTO households (id, name, invite_code, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [householdId, 'Demo House', 'DEMO01', users[0].id]
    );

    // Add all users as members
    for (let i = 0; i < users.length; i++) {
      await pool.query(
        'INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [householdId, users[i].id, i === 0 ? 'admin' : 'member']
      );
    }

    // Create demo tasks
    const taskId1 = uuidv4();
    await pool.query(
      `INSERT INTO tasks (id, household_id, title, rotation_type, frequency_days, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [taskId1, householdId, 'Clean kitchen', 'round-robin', 7, users[0].id]
    );

    const taskId2 = uuidv4();
    await pool.query(
      `INSERT INTO tasks (id, household_id, title, rotation_type, frequency_days, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [taskId2, householdId, 'Take out bins', 'round-robin', 7, users[0].id]
    );

    // Create a demo task assignment & members
    const assignmentId1 = uuidv4();
    await pool.query(
      `INSERT INTO task_assignments (id, task_id, due_date, status)
       VALUES ($1,$2,NOW()+INTERVAL '3 days','pending') ON CONFLICT DO NOTHING`,
      [assignmentId1, taskId1]
    );
    await pool.query(
      `INSERT INTO task_assignment_members (assignment_id, user_id, completed)
       VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`,
      [assignmentId1, users[0].id]
    );

    // Create demo bills and splits
    const billId = uuidv4();
    await pool.query(
      `INSERT INTO bills (id, household_id, title, total_amount, created_by, split_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [billId, householdId, 'Monthly rent', 1500.00, users[0].id, 'equal', 'unpaid']
    );
    for (const u of users) {
      await pool.query(
        'INSERT INTO bill_splits (id, bill_id, user_id, amount, paid) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [uuidv4(), billId, u.id, 500.00, false]
      );
    }

    // Create demo purchase
    const purchaseId = uuidv4();
    await pool.query(
      `INSERT INTO purchases (id, household_id, created_by, item_name, description, target_amount, current_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [purchaseId, householdId, users[0].id, 'New Sofa', 'For the living room', 300.00, 100.00, 'open']
    );
    await pool.query(
      `INSERT INTO purchase_contributions (id, purchase_id, user_id, amount)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uuidv4(), purchaseId, users[1].id, 100.00]
    );

    console.log('✅ Seed complete!');
    console.log('   Demo users: alice@demo.com, bob@demo.com, carol@demo.com');
    console.log('   Password: password123');
    console.log('   Invite code: DEMO01');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    await pool.end();
  }
})();
