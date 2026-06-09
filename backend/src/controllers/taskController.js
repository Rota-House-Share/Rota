const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// =============================================================================
// DATA MODEL — Assignment vs Completion are completely separate concerns
//
// tasks                  — the chore definition (title, frequency, etc.)
// task_assignments       — one row per "active round" of a task
//                          status: 'pending' | 'completed'
//                          NEVER modified by completion logic (except status)
// task_assignment_members — one row per assigned user per round
//                          Fields: user_id, completed, completed_at
//                          THIS is where completion is tracked
//                          Assignment (user_id) is NEVER changed during completion
//
// Completion rule:
//   - Only assigned users (rows in task_assignment_members) may update status
//   - A task_assignment becomes 'completed' when ALL its member rows have
//     completed = TRUE
//   - Completion NEVER creates new rows, NEVER modifies user_id fields
// =============================================================================


// ---------------------------------------------------------------------------
// POST /api/households/:householdId/tasks
// Body: { title, description?, assigned_to?: string[], frequency_days?: number }
//
// assigned_to = array of user UUIDs. If omitted, defaults to all members.
// ---------------------------------------------------------------------------
const createTask = async (req, res, next) => {
  const { householdId } = req.params;
  const { title, description, assigned_to, frequency_days = 7 } = req.body;
  if (!title) return res.status(400).json({ error: 'Task title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the task definition
    const task = await client.query(
      `INSERT INTO tasks (household_id, created_by, title, description, frequency_days)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [householdId, req.user.id, title, description || null, frequency_days]
    );
    const taskId = task.rows[0].id;

    // Resolve assignees
    let assignees = Array.isArray(assigned_to) && assigned_to.length > 0
      ? assigned_to
      : null;

    if (!assignees) {
      const members = await client.query(
        'SELECT user_id FROM household_members WHERE household_id = $1 ORDER BY joined_at',
        [householdId]
      );
      assignees = members.rows.map(r => r.user_id);
    }

    if (assignees.length > 0) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + frequency_days);

      // One task_assignments row = one round
      const ta = await client.query(
        'INSERT INTO task_assignments (task_id, due_date) VALUES ($1, $2) RETURNING id',
        [taskId, dueDate.toISOString().split('T')[0]]
      );
      const assignmentId = ta.rows[0].id;

      // One task_assignment_members row per assigned user
      for (const userId of assignees) {
        await client.query(
          'INSERT INTO task_assignment_members (assignment_id, user_id) VALUES ($1, $2)',
          [assignmentId, userId]
        );
      }
    }

    await client.query('COMMIT');
    broadcast(householdId, { type: 'TASK_CREATED', taskId });
    res.status(201).json({ task: task.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};


// ---------------------------------------------------------------------------
// GET /api/households/:householdId/tasks
//
// Returns tasks with per-user fields so each person's own completion state
// drives which tab they see the task in.
//
// my_status   : 'completed' | 'pending' | 'unassigned'
// am_assigned : true | false
// assignees   : [{ id, name, avatar_url, completed, completed_at }]
//
// Assignment data (user_id fields) is NEVER affected by completion state.
// ---------------------------------------------------------------------------
const getTasks = async (req, res, next) => {
  const { householdId } = req.params;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.description,
         t.household_id,
         t.frequency_days,
         t.created_at,
         ta.id                          AS assignment_id,
         COALESCE(ta.status, 'pending') AS status,
         ta.due_date,
         ta.completed_at,

         -- Per-user status (drives tab placement for THIS user only)
         CASE
           WHEN tam.user_id IS NOT NULL AND tam.completed = TRUE  THEN 'completed'
           WHEN tam.user_id IS NOT NULL AND tam.completed = FALSE THEN 'pending'
           ELSE 'unassigned'
         END AS my_status,

         -- Whether the current user may interact with the completion control
         (tam.user_id IS NOT NULL) AS am_assigned,

         -- Full assignee list with per-person completion state
         -- user_id values in this array are NEVER modified by completion logic
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id',           u.id,
                 'name',         u.name,
                 'avatar_url',   u.avatar_url,
                 'completed',    tam2.completed,
                 'completed_at', tam2.completed_at,
                 'proof_url',    tam2.proof_url
               )
               ORDER BY u.name
             )
             FROM task_assignment_members tam2
             JOIN users u ON u.id = tam2.user_id
             WHERE tam2.assignment_id = ta.id
           ),
           '[]'::json
         ) AS assignees,

         tam.proof_url AS my_proof_url

       FROM tasks t
       -- Get the latest assignment (most recent created_at)
       LEFT JOIN LATERAL (
         SELECT * FROM task_assignments
         WHERE task_id = t.id
         ORDER BY created_at DESC
         LIMIT 1
       ) ta ON TRUE
       -- Current user's member row (NULL if not assigned)
       LEFT JOIN task_assignment_members tam
         ON tam.assignment_id = ta.id
        AND tam.user_id = $2
       WHERE t.household_id = $1
       ORDER BY t.created_at DESC`,
      [householdId, userId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};


// ---------------------------------------------------------------------------
// PATCH /api/tasks/:taskId/toggle
//
// Completion rules:
//   1. Only assigned users may toggle (403 for unassigned).
//   2. Flips the current user's completed flag.
//   3. task_assignment.status becomes 'completed' when ALL member rows
//      have completed = TRUE; reverts to 'pending' otherwise.
//   4. Assignment data (user_id fields) is NEVER touched.
//   5. No new rows are created. No round-robin rotation.
//
// Returns:
//   { status, myCompleted, assignees }
//   — assignees includes every member's updated completion state so
//     the broadcast can update all clients without a re-fetch.
// ---------------------------------------------------------------------------
const toggleTaskStatus = async (req, res, next) => {
  const { taskId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load the latest assignment (lock to prevent concurrent toggles)
    const latest = await client.query(
      `SELECT * FROM task_assignments
       WHERE task_id = $1
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [taskId]
    );
    if (latest.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No assignment found for this task' });
    }
    const assignment = latest.rows[0];

    // 2. Verify the current user is assigned — assignment data is immutable
    const memberCheck = await client.query(
      `SELECT * FROM task_assignment_members
       WHERE assignment_id = $1 AND user_id = $2`,
      [assignment.id, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You are not assigned to this task' });
    }

    // 3. Flip only the completion fields — user_id is never touched
    //    Also save proof_url when marking complete (req.proofUrl set by multer middleware)
    const proofUrl = req.proofUrl || null;
    const flipped = await client.query(
      `UPDATE task_assignment_members
         SET completed    = NOT completed,
             completed_at = CASE WHEN NOT completed THEN NOW() ELSE NULL END,
             proof_url    = CASE WHEN NOT completed THEN $3 ELSE NULL END
       WHERE assignment_id = $1 AND user_id = $2
       RETURNING completed, completed_at, proof_url`,
      [assignment.id, req.user.id, proofUrl]
    );
    const myCompleted = flipped.rows[0].completed;

    // 4. Determine the overall assignment status
    //    'completed' only when EVERY assigned member has completed = TRUE
    const pendingCount = await client.query(
      `SELECT COUNT(*) FROM task_assignment_members
       WHERE assignment_id = $1 AND completed = FALSE`,
      [assignment.id]
    );
    const allDone    = parseInt(pendingCount.rows[0].count) === 0;
    const nextStatus = allDone ? 'completed' : 'pending';

    await client.query(
      `UPDATE task_assignments
         SET status       = $1,
             completed_at = $2
       WHERE id = $3`,
      [nextStatus, allDone ? new Date() : null, assignment.id]
    );

    // 5. Fetch the full updated assignees array (assignment user_ids unchanged)
    const assigneesResult = await client.query(
      `SELECT
         u.id,
         u.name,
         u.avatar_url,
         tam.completed,
         tam.completed_at,
         tam.proof_url
       FROM task_assignment_members tam
       JOIN users u ON u.id = tam.user_id
       WHERE tam.assignment_id = $1
       ORDER BY u.name`,
      [assignment.id]
    );
    const assignees = assigneesResult.rows;

    // 6. Get household_id for broadcast
    const taskInfo = await client.query(
      'SELECT household_id FROM tasks WHERE id = $1', [taskId]
    );
    const householdId = taskInfo.rows[0]?.household_id;

    await client.query('COMMIT');

    // 7. Broadcast updated state to all household members
    //    Include full assignees so clients update without a re-fetch
    if (householdId) {
      broadcast(householdId, {
        type:     'TASK_TOGGLED',
        taskId,
        status:   nextStatus,
        assignees,           // full list with updated completed flags
        by:       req.user.id
      });
    }

    res.json({ status: nextStatus, myCompleted, assignees });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};


// ---------------------------------------------------------------------------
// PUT /api/tasks/:taskId/assign
// Body: { user_ids: string[], due_date: string }
//
// Creates a new assignment round for the task with a new set of assignees.
// Used for manual reassignment / starting a new round after completion.
// ---------------------------------------------------------------------------
const assignTask = async (req, res, next) => {
  const { taskId } = req.params;
  const { user_ids, due_date } = req.body;
  if (!Array.isArray(user_ids) || user_ids.length === 0 || !due_date) {
    return res.status(400).json({ error: 'user_ids (non-empty array) and due_date are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ta = await client.query(
      'INSERT INTO task_assignments (task_id, due_date) VALUES ($1, $2) RETURNING *',
      [taskId, due_date]
    );
    const assignmentId = ta.rows[0].id;
    for (const userId of user_ids) {
      await client.query(
        'INSERT INTO task_assignment_members (assignment_id, user_id) VALUES ($1, $2)',
        [assignmentId, userId]
      );
    }
    await client.query('COMMIT');
    const task = await pool.query(
      'SELECT household_id FROM tasks WHERE id = $1', [taskId]
    );
    if (task.rows.length > 0) {
      broadcast(task.rows[0].household_id, { type: 'TASK_ASSIGNED', taskId });
    }
    res.json({ assignment: ta.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};


// ---------------------------------------------------------------------------
// DELETE /api/tasks/:taskId
// ---------------------------------------------------------------------------
const deleteTask = async (req, res, next) => {
  const { taskId } = req.params;
  try {
    const task = await pool.query(
      'SELECT household_id FROM tasks WHERE id = $1', [taskId]
    );
    if (task.rows.length === 0)
      return res.status(404).json({ error: 'Task not found' });
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    broadcast(task.rows[0].household_id, { type: 'TASK_DELETED', taskId });
    res.json({ message: 'Task deleted' });
  } catch (err) { next(err); }
};


module.exports = { createTask, getTasks, toggleTaskStatus, assignTask, deleteTask };
