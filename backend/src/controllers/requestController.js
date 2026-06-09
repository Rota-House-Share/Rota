const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// GET /api/requests?householdId=xxx
async function getRequests(req, res) {
  const { householdId } = req.query;
  if (!householdId) return res.status(400).json({ error: 'householdId required' });
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS created_by_name
       FROM requests r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.household_id = $1
       ORDER BY r.created_at DESC`,
      [householdId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/requests
async function createRequest(req, res) {
  const { householdId, type, category, title, description } = req.body;
  if (!householdId || !type || !category || !title)
    return res.status(400).json({ error: 'householdId, type, category, title required' });
  const photoUrls = req.photoUrls || [];
  try {
    const { rows } = await pool.query(
      `INSERT INTO requests (household_id, created_by, type, category, title, description, photo_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [householdId, req.user.id, type, category, title, description || null, JSON.stringify(photoUrls)]
    );
    const newRequest = { ...rows[0], created_by_name: req.user.name };
    broadcast(householdId, { type: 'REQUEST_CREATED', request: newRequest });
    res.status(201).json(newRequest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Middleware: only admin of the request's household can change status
async function adminStatusGuard(req, res, next) {
  const { id } = req.params;
  try {
    const r = await pool.query(`SELECT household_id FROM requests WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Request not found' });
    const m = await pool.query(
      `SELECT role FROM household_members WHERE household_id=$1 AND user_id=$2`,
      [r.rows[0].household_id, req.user.id]
    );
    if (!m.rows.length || m.rows[0].role !== 'admin')
      return res.status(403).json({ error: 'Only admins can update request status' });
    req.requestHouseholdId = r.rows[0].household_id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// PATCH /api/requests/:id/status  (admin only — enforced in route)
async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['In Progress', 'Completed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      `UPDATE requests SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    broadcast(rows[0].household_id, { type: 'REQUEST_STATUS_CHANGED', requestId: id, status });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// DELETE /api/requests/:id  (admin only)
async function deleteRequest(req, res) {
  const { id } = req.params;
  try {
    const r = await pool.query(`SELECT household_id FROM requests WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const m = await pool.query(
      `SELECT role FROM household_members WHERE household_id=$1 AND user_id=$2`,
      [r.rows[0].household_id, req.user.id]
    );
    if (!m.rows.length || m.rows[0].role !== 'admin')
      return res.status(403).json({ error: 'Only admins can delete requests' });
    await pool.query(`DELETE FROM requests WHERE id=$1`, [id]);
    broadcast(r.rows[0].household_id, { type: 'REQUEST_DELETED', requestId: id });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/requests/:id/comments
async function getComments(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT rc.*, u.name AS user_name
       FROM request_comments rc
       LEFT JOIN users u ON u.id = rc.user_id
       WHERE rc.request_id = $1
       ORDER BY rc.created_at ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/requests/:id/comments
async function addComment(req, res) {
  const { id } = req.params;
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO request_comments (request_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.user.id, message]
    );
    // Get household_id to broadcast to the right room
    const req2 = await pool.query(`SELECT household_id FROM requests WHERE id=$1`, [id]);
    if (req2.rows.length) {
      broadcast(req2.rows[0].household_id, {
        type: 'REQUEST_COMMENT', requestId: id,
        comment: { ...rows[0], user_name: req.user.name }
      });
    }
    res.status(201).json({ ...rows[0], user_name: req.user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getRequests, createRequest, adminStatusGuard, updateStatus, deleteRequest, getComments, addComment };
