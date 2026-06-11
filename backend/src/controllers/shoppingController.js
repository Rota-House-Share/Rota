const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');
const { sendNotification } = require('./notificationController');

// GET /api/households/:householdId/shopping
const listItems = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT s.*, u.name AS added_by_name, pu.name AS purchased_by_name
         FROM shopping_items s
         LEFT JOIN users u  ON u.id  = s.added_by
         LEFT JOIN users pu ON pu.id = s.purchased_by
        WHERE s.household_id = $1
        ORDER BY s.created_at DESC`,
      [householdId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
};

// POST /api/households/:householdId/shopping
const addItem = async (req, res, next) => {
  const { householdId } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Item name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO shopping_items (household_id, added_by, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [householdId, req.user.id, name.trim()]
    );
    const item = { ...rows[0], added_by_name: req.user.name };
    broadcast(householdId, { type: 'SHOPPING_ADDED', item });

    // Notify all OTHER household members
    const members = await pool.query(
      'SELECT user_id FROM household_members WHERE household_id = $1', [householdId]
    );
    for (const m of members.rows) {
      if (String(m.user_id) === String(req.user.id)) continue;
      await sendNotification(m.user_id, householdId, 'shopping_item_added',
        `${req.user.name} added "${name.trim()}" to the shopping list`);
    }

    res.status(201).json({ item });
  } catch (err) { next(err); }
};

// PATCH /api/households/:householdId/shopping/:itemId/toggle
const toggleItem = async (req, res, next) => {
  const { householdId, itemId } = req.params;
  try {
    // Flip status
    const { rows } = await pool.query(
      `UPDATE shopping_items
          SET status       = CASE WHEN status = 'tobuy' THEN 'purchased' ELSE 'tobuy' END,
              purchased_by = CASE WHEN status = 'tobuy' THEN $1::uuid ELSE NULL END,
              purchased_at = CASE WHEN status = 'tobuy' THEN NOW() ELSE NULL END
        WHERE id = $2 AND household_id = $3
        RETURNING *`,
      [req.user.id, itemId, householdId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    const item = rows[0];
    broadcast(householdId, { type: 'SHOPPING_TOGGLED', item });

    // Notify others when someone marks something as purchased
    if (item.status === 'purchased') {
      const members = await pool.query(
        'SELECT user_id FROM household_members WHERE household_id = $1', [householdId]
      );
      for (const m of members.rows) {
        if (String(m.user_id) === String(req.user.id)) continue;
        await sendNotification(m.user_id, householdId, 'shopping_item_purchased',
          `${req.user.name} bought "${item.name}" ✓`);
      }
    }

    res.json({ item });
  } catch (err) { next(err); }
};

// DELETE /api/households/:householdId/shopping/:itemId
const deleteItem = async (req, res, next) => {
  const { householdId, itemId } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM shopping_items WHERE id = $1 AND household_id = $2',
      [itemId, householdId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    broadcast(householdId, { type: 'SHOPPING_DELETED', itemId });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

module.exports = { listItems, addItem, toggleItem, deleteItem };
