const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// Helper — insert a notification and broadcast to the recipient
const sendNotification = async (userId, householdId, type, message, data = null) => {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, household_id, type, message, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, householdId, type, message, data ? JSON.stringify(data) : null]
  );
  // Broadcast so the recipient's notifications page updates in real-time
  broadcast(householdId, {
    type:         'NOTIFICATION_CREATED',
    notification: result.rows[0],
    forUserId:    userId,
  });
  return result.rows[0];
};

// GET /api/notifications
const getNotifications = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) { next(err); }
};

// PUT /api/notifications/:id/read
const markRead = async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// PUT /api/notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// DELETE /api/notifications/:id
const deleteNotification = async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// DELETE /api/notifications  (clear all)
const clearNotifications = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

module.exports = { sendNotification, getNotifications, markRead, markAllRead, deleteNotification, clearNotifications };
