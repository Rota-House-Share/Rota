// =============================================================================
// Group Dashboard — chores, members (with kick), shopping, purchases
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');
  initNotifDot();
  initNavDropdown();

  const hh = await requireMembership();
  if (!hh) return;

  const householdId = hh.id;
  const user = getUser();
  if (!user) { clearSession(); return; }

  let tasks     = [];
  let members   = [];
  let purchases = [];
  let myRole    = 'member';
  let currentChoreTab = 'pending';
  const pendingProofs = {};

  // =========================================================================
  // HOUSEHOLD + MEMBERS
  // =========================================================================
  try {
    const household = await apiFetch('/households/' + householdId);
    document.getElementById('groupNameDisplay').textContent = household.name;
    document.getElementById('groupDescDisplay').textContent = household.address || 'Welcome back!';
    document.getElementById('groupIdDisplay').textContent   = household.invite_code ? '#' + household.invite_code : '';
    members = household.members || [];
    const me = members.find(m => String(m.id) === String(user.id));
    myRole = me ? me.role : 'member';
    renderMembers();
  } catch (err) {
    console.error('Household load failed:', err.message);
    toast('Could not load household', 'error');
  }

  function renderMembers() {
    const list = document.getElementById('memberList');
    if (!list) return;
    if (members.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;">No members.</p>';
      return;
    }
    list.innerHTML = members.map(m => {
      const parts    = (m.name || '').trim().split(/\s+/);
      const initials = (parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : (m.name || '??').substring(0, 2)).toUpperCase();

      const roleBadge = m.role === 'admin'
        ? '<span class="role-chip admin">ADMIN</span>'
        : '';

      // FIX (Bug #2): Kick button rendered only for admins viewing OTHER members.
      // Admins cannot kick themselves — the self-row has no button.
      const isSelf   = String(m.id) === String(user.id);
      const canKick  = myRole === 'admin' && !isSelf;
      const kickBtn  = canKick
        ? `<button class="kick-btn" title="Remove ${m.name}" onclick="openKickModal('${m.id}','${escapeAttr(m.name)}')"><i data-lucide="user-x"></i></button>`
        : '';

      return `<div class="member" style="display:flex;align-items:center;gap:10px;padding:8px 0;">
        <div class="m-avatar">${initials}</div>
        <span style="flex:1;">${m.name}${isSelf ? ' (you)' : ''}</span>
        ${roleBadge}
        ${kickBtn}
      </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // =========================================================================
  // CHORES (Bug #1)
  // =========================================================================
  try {
    tasks = await apiFetch('/households/' + householdId + '/tasks');
    renderChores();
    checkDueReminders(tasks);
  } catch (err) {
    console.error('Tasks load failed:', err.message);
    tasks = JSON.parse(localStorage.getItem('rota_tasks_' + householdId)) || [];
    renderChores();
  }

  // Browser notification reminders for tasks due within 24 hours
  async function checkDueReminders(allTasks) {
    const myPending = allTasks.filter(t => t.am_assigned && t.my_status !== 'completed' && t.due_date);
    if (myPending.length === 0) return;

    const now = Date.now();
    const soon = myPending.filter(t => {
      const due = new Date(t.due_date).getTime();
      return due - now <= 86400000; // within 24h (including overdue)
    });
    if (soon.length === 0) return;

    // Ask permission once, then fire
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return;

    // Don't spam — only remind once per session per task
    const reminded = JSON.parse(sessionStorage.getItem('rota_reminded') || '[]');
    for (const t of soon) {
      if (reminded.includes(t.id)) continue;
      const due   = new Date(t.due_date);
      const days  = Math.ceil((due.setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
      const label = days < 0 ? 'overdue' : days === 0 ? 'due today' : 'due tomorrow';
      new Notification('Rota Reminder', {
        body: `"${t.title}" is ${label}`,
        icon: '/favicon.ico',
        tag:  'rota-task-' + t.id,
      });
      reminded.push(t.id);
    }
    sessionStorage.setItem('rota_reminded', JSON.stringify(reminded));
  }

  function renderChores() {
    const list = document.getElementById('choreList');
    if (!list) return;

    // Admins see all tasks. Regular users only see tasks assigned to them.
    const visible = myRole === 'admin'
      ? tasks
      : tasks.filter(t => t.am_assigned === true);

    const filtered = visible.filter(t => {
      // Admins aren't assigned so use overall task status; users use their own
      const s = myRole === 'admin'
        ? (t.status || 'pending')
        : (t.my_status || 'pending');
      return currentChoreTab === 'pending' ? s !== 'completed' : s === 'completed';
    });

    if (filtered.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">No tasks here yet.</p>';
      return;
    }

    list.innerHTML = filtered.map(t => {
      const assignees  = Array.isArray(t.assignees) ? t.assignees : [];
      const myStatus   = t.my_status || 'pending';
      const myDone     = myRole === 'admin'
        ? (t.status || 'pending') === 'completed'
        : myStatus === 'completed';

      // Avatar row — green = completed, purple = pending
      const avatarRow = assignees.length > 0
        ? assignees.map(a => `
            <span title="${escapeAttr(a.name)}${a.completed ? ' ✓' : ''}" style="
              display:inline-flex;align-items:center;justify-content:center;
              width:24px;height:24px;border-radius:50%;
              background:${a.completed ? '#43d9a2' : '#6c63ff'};
              color:white;font-size:.62rem;font-weight:700;
              margin-right:3px;flex-shrink:0;">
              ${escapeHtml((a.name || '??').substring(0, 2).toUpperCase())}
            </span>`).join('')
        : '<span style="color:#94a3b8;font-size:.8rem;">Unassigned</span>';

      const statusLabel = myDone
        ? `<span style="font-size:.75rem;color:#43d9a2;margin-left:4px;">✓ Done</span>`
        : '';

      // Due-date badge
      let dueBadge = '';
      if (!myDone && t.due_date) {
        const due  = new Date(t.due_date);
        const now  = new Date();
        const days = Math.ceil((due.setHours(0,0,0,0) - now.setHours(0,0,0,0)) / 86400000);
        if (days < 0) {
          dueBadge = `<span style="font-size:.7rem;background:#fee2e2;color:#dc2626;border-radius:6px;padding:1px 6px;font-weight:700;margin-left:4px;">Overdue</span>`;
        } else if (days === 0) {
          dueBadge = `<span style="font-size:.7rem;background:#ffedd5;color:#ea580c;border-radius:6px;padding:1px 6px;font-weight:700;margin-left:4px;">Due today</span>`;
        } else if (days === 1) {
          dueBadge = `<span style="font-size:.7rem;background:#fef9c3;color:#ca8a04;border-radius:6px;padding:1px 6px;font-weight:700;margin-left:4px;">Due tomorrow</span>`;
        } else if (days <= 3) {
          dueBadge = `<span style="font-size:.7rem;background:#f1f5f9;color:#64748b;border-radius:6px;padding:1px 6px;font-weight:600;margin-left:4px;">Due in ${days}d</span>`;
        }
      }

      // Delete button — admins only (stop propagation so card click doesn't open modal)
      const deleteBtn = myRole === 'admin'
        ? `<button onclick="event.stopPropagation();deleteChore('${t.id}')" title="Delete task"
                   style="background:none;border:none;cursor:pointer;padding:4px;
                          color:#94a3b8;flex-shrink:0;line-height:0;transition:color .15s;"
                   onmouseover="this.style.color='#f87171'"
                   onmouseout="this.style.color='#94a3b8'">
             <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
           </button>`
        : '';

      return `
        <div class="chore-item ${myDone ? 'done' : ''}" data-id="${t.id}"
             onclick="openTaskDetail('${t.id}')" style="cursor:pointer;">
          <div class="chore-check ${myDone ? 'checked' : ''}" style="cursor:default;pointer-events:none;">
            ${myDone ? '<i data-lucide="check" style="width:14px"></i>' : ''}
          </div>
          <div class="chore-info" style="flex:1;min-width:0;">
            <span class="chore-title">${escapeHtml(t.title)}</span>
            <div class="chore-meta" style="display:flex;align-items:center;gap:3px;margin-top:4px;flex-wrap:wrap;">
              ${avatarRow}
              ${statusLabel}
              ${dueBadge}
              ${t.description ? `<span style="font-size:.72rem;color:#6c63ff;margin-left:4px;display:flex;align-items:center;gap:2px;"><i data-lucide="file-text" style="width:11px;height:11px;"></i></span>` : ''}
            </div>
          </div>
          ${deleteBtn}
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Task Detail Modal ────────────────────────────────────────────────────
  if (!document.getElementById('taskDetailModal')) {
    const el = document.createElement('div');
    el.id = 'taskDetailModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = `
      <div style="background:var(--white,#fff);border-radius:20px;width:100%;max-width:500px;
                  max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:18px 20px 14px;border-bottom:1px solid var(--border,#e2e8f0);
                    position:sticky;top:0;background:var(--white,#fff);z-index:1;">
          <h3 id="tdTitle" style="margin:0;font-size:1.05rem;font-weight:700;"></h3>
          <button onclick="closeTaskDetail()" style="background:none;border:none;cursor:pointer;
            color:#94a3b8;font-size:22px;line-height:1;padding:2px 6px;">✕</button>
        </div>
        <div id="tdBody" style="padding:18px 20px;display:flex;flex-direction:column;gap:16px;"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closeTaskDetail(); });
  }

  window.openTaskDetail = (taskId) => {
    const t = tasks.find(x => String(x.id) === String(taskId));
    if (!t) return;

    const assignees  = Array.isArray(t.assignees) ? t.assignees : [];
    const amAssigned = t.am_assigned === true;
    const myDone     = myRole === 'admin'
      ? (t.status || 'pending') === 'completed'
      : (t.my_status || 'pending') === 'completed';

    const pendingBefore = pendingProofs[taskId]?.before;
    const pendingAfter  = pendingProofs[taskId]?.after;

    // Assignee pills
    const assigneePills = assignees.map(a => `
      <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
        border-radius:20px;background:${a.completed ? 'rgba(67,217,162,.12)' : 'rgba(108,99,255,.1)'};
        font-size:.8rem;font-weight:600;color:${a.completed ? '#16a34a' : '#6c63ff'};">
        ${escapeHtml(a.name)} ${a.completed ? '✓' : ''}
      </span>`).join('');

    // Admin proof photos section — proof_url is JSON {before, after}
    const proofsForTask = assignees.filter(a => a.proof_url);
    const adminProofs = myRole === 'admin' && proofsForTask.length > 0
      ? `<div>
           <p style="font-size:.78rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;">Proof Photos</p>
           ${proofsForTask.map(p => {
             let urls = { before: null, after: null };
             try { urls = JSON.parse(p.proof_url); } catch { urls.after = p.proof_url; }
             const date = p.completed_at ? new Date(p.completed_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
             return `
               <div style="border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px 14px;margin-bottom:10px;">
                 <div style="font-size:.82rem;font-weight:600;color:#475569;margin-bottom:8px;">
                   ${escapeHtml(p.name)} ${date ? '· ' + date : ''}
                 </div>
                 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                   ${urls.before ? `<div><p style="font-size:.72rem;color:#94a3b8;margin:0 0 4px;">Before</p>
                     <img src="${escapeAttr(urls.before)}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;"></div>` : ''}
                   ${urls.after  ? `<div><p style="font-size:.72rem;color:#94a3b8;margin:0 0 4px;">After</p>
                     <img src="${escapeAttr(urls.after)}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;"></div>` : ''}
                 </div>
               </div>`;
           }).join('')}
         </div>`
      : '';

    // Photo upload section — only for assigned users on pending tasks
    const photoUpload = amAssigned && !myDone
      ? `<div>
           <p style="font-size:.78rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;">Proof Photos</p>
           <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
             <!-- Before photo -->
             <div>
               <p style="font-size:.8rem;font-weight:600;margin:0 0 6px;color:#64748b;">Before</p>
               <input type="file" accept="image/*" capture="environment" id="before-input-${taskId}" style="display:none;"
                      onchange="handleDetailProof('${taskId}','before',this)">
               <div onclick="document.getElementById('before-input-${taskId}').click()"
                    style="height:120px;border:2px dashed ${pendingBefore ? '#43d9a2' : 'var(--border,#e2e8f0)'};
                           border-radius:12px;display:flex;flex-direction:column;align-items:center;
                           justify-content:center;cursor:pointer;gap:6px;overflow:hidden;
                           background:${pendingBefore ? 'rgba(67,217,162,.06)' : 'var(--bg,#f8fafc)'};">
                 ${pendingBefore
                   ? `<img src="${URL.createObjectURL(pendingBefore)}" style="width:100%;height:100%;object-fit:cover;">`
                   : `<i data-lucide="camera" style="width:22px;height:22px;color:#94a3b8;"></i>
                      <span style="font-size:.75rem;color:#94a3b8;">Tap to add</span>`}
               </div>
             </div>
             <!-- After photo -->
             <div>
               <p style="font-size:.8rem;font-weight:600;margin:0 0 6px;color:#64748b;">After</p>
               <input type="file" accept="image/*" capture="environment" id="after-input-${taskId}" style="display:none;"
                      onchange="handleDetailProof('${taskId}','after',this)">
               <div onclick="document.getElementById('after-input-${taskId}').click()"
                    style="height:120px;border:2px dashed ${pendingAfter ? '#43d9a2' : 'var(--border,#e2e8f0)'};
                           border-radius:12px;display:flex;flex-direction:column;align-items:center;
                           justify-content:center;cursor:pointer;gap:6px;overflow:hidden;
                           background:${pendingAfter ? 'rgba(67,217,162,.06)' : 'var(--bg,#f8fafc)'};">
                 ${pendingAfter
                   ? `<img src="${URL.createObjectURL(pendingAfter)}" style="width:100%;height:100%;object-fit:cover;">`
                   : `<i data-lucide="camera" style="width:22px;height:22px;color:#94a3b8;"></i>
                      <span style="font-size:.75rem;color:#94a3b8;">Tap to add</span>`}
               </div>
             </div>
           </div>
           <button id="td-submit-${taskId}" onclick="submitDetailCompletion('${taskId}')"
                   ${pendingBefore && pendingAfter ? '' : 'disabled'}
                   style="width:100%;margin-top:14px;padding:12px;border:none;border-radius:12px;
                          font-size:.95rem;font-weight:700;cursor:${pendingBefore && pendingAfter ? 'pointer' : 'not-allowed'};
                          background:${pendingBefore && pendingAfter ? '#6c63ff' : '#e2e8f0'};
                          color:${pendingBefore && pendingAfter ? '#fff' : '#94a3b8'};
                          font-family:inherit;transition:all .2s;">
             ${pendingBefore && pendingAfter ? 'Mark as Complete' : 'Add both photos to complete'}
           </button>
         </div>`
      : '';

    document.getElementById('tdTitle').textContent = t.title;
    document.getElementById('tdBody').innerHTML = `
      ${t.description ? `
        <div>
          <p style="font-size:.78rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px;">Description</p>
          <p style="font-size:.9rem;color:#475569;line-height:1.6;margin:0;padding:12px 14px;
             background:rgba(108,99,255,.05);border-radius:10px;border-left:3px solid #6c63ff;">
            ${escapeHtml(t.description)}
          </p>
        </div>` : ''}
      <div>
        <p style="font-size:.78rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px;">Assigned To</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${assigneePills || '<span style="color:#94a3b8;font-size:.85rem;">Unassigned</span>'}</div>
      </div>
      ${adminProofs}
      ${photoUpload}
    `;
    document.getElementById('taskDetailModal').style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  window.closeTaskDetail = () => {
    document.getElementById('taskDetailModal').style.display = 'none';
  };

  window.deleteChore = async (id) => {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    try {
      await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
      tasks = tasks.filter(t => String(t.id) !== String(id));
      renderChores();
      toast('Task deleted', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete task', 'error');
    }
  };

  window.switchChoreTab = (tab) => {
    currentChoreTab = tab === 'todo' ? 'pending' : 'completed';
    document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderChores();
  };

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Called from task detail modal when user picks before/after photo
  window.handleDetailProof = async (taskId, slot, input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast('Only JPEG, PNG or WebP photos allowed', 'error');
      return;
    }
    const compressed = await compressImage(file);
    if (!pendingProofs[taskId]) pendingProofs[taskId] = {};
    pendingProofs[taskId][slot] = compressed;
    // Re-open modal to refresh the preview
    openTaskDetail(taskId);
  };

  // Called when user clicks "Mark as Complete" in the task detail modal
  window.submitDetailCompletion = async (taskId) => {
    const proofs = pendingProofs[taskId] || {};
    if (!proofs.before || !proofs.after) {
      toast('Please add both before and after photos', 'error');
      return;
    }

    const btn = document.getElementById(`td-submit-${taskId}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const form = new FormData();
      form.append('proof_before', proofs.before, 'before.jpg');
      form.append('proof_after',  proofs.after,  'after.jpg');

      const tkn = getToken();
      const res = await fetch(`/api/tasks/${taskId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + tkn },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      const result = await res.json();
      const { myCompleted, assignees: updatedAssignees } = result;

      delete pendingProofs[taskId];

      const localTask = tasks.find(t => String(t.id) === String(taskId));
      if (localTask) {
        localTask.my_status = myCompleted ? 'completed' : 'pending';
        if (Array.isArray(updatedAssignees)) localTask.assignees = updatedAssignees;
      }
      closeTaskDetail();
      renderChores();
      toast('Task marked complete!', 'success');
    } catch (err) {
      toast(err.message || 'Could not update task', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Mark as Complete'; }
    }
  };

  // =========================================================================
  // ADD CHORE MODAL
  // =========================================================================
  window.openModal = () => {
    const wrap = document.getElementById('choreAssignees');
    if (wrap) {
      wrap.innerHTML = members.map(m => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer;user-select:none;border-radius:8px;transition:background .15s;" onmouseover="this.style.background='rgba(108,99,255,.08)'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" value="${m.id}" style="width:16px;height:16px;cursor:pointer;accent-color:#6c63ff;flex-shrink:0;">
          <div style="
            width:32px;height:32px;
            border-radius:50%;
            background:#6c63ff;
            color:white;
            font-size:.7rem;font-weight:700;
            display:flex;align-items:center;justify-content:center;
            flex-shrink:0;flex-grow:0;">
            ${escapeHtml((m.name || '??').substring(0, 2).toUpperCase())}
          </div>
          <span style="font-size:.9rem;color:inherit;">${escapeHtml(m.name)}</span>
        </label>`).join('');
    }
    document.getElementById('choreModal').style.display = 'flex';
  };
  window.closeModal = () => { document.getElementById('choreModal').style.display = 'none'; };

  window.confirmAddChore = async () => {
    const titleEl = document.getElementById('newChoreTitle');
    const descEl  = document.getElementById('newChoreDesc');
    const title   = titleEl.value.trim();
    const description = descEl ? descEl.value.trim() : '';
    if (!title) { toast('Enter a task title', 'error'); return; }

    // Collect all ticked checkboxes as an array of UUIDs
    const checked  = document.querySelectorAll('#choreAssignees input[type="checkbox"]:checked');
    const assignees = Array.from(checked).map(cb => cb.value);

    try {
      await apiFetch('/households/' + householdId + '/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description: description || null, assigned_to: assignees.length > 0 ? assignees : null })
      });
      titleEl.value = '';
      if (descEl) descEl.value = '';
      closeModal();
      tasks = await apiFetch('/households/' + householdId + '/tasks');
      localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
      renderChores();
      toast('Task added', 'success');
    } catch (err) {
      toast(err.message || 'Could not add task', 'error');
    }
  };

  // =========================================================================
  // LEAVE HOUSEHOLD
  // =========================================================================
  window.handleLeaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this house group?')) return;
    try {
      await apiFetch(`/households/${householdId}/members/me`, { method: 'DELETE' });
    } catch (err) {
      toast('Could not leave: ' + (err.message || 'unknown error'), 'error');
      return;
    }
    clearHouseholdCache();
    sessionStorage.setItem('rota_flash', JSON.stringify({
      type: 'success', msg: 'You have left the household.'
    }));
    window.location.href = 'home.html';
  };

  // =========================================================================
  // KICK MEMBER (Bug #2)
  // =========================================================================
  let kickTargetId   = null;
  let kickTargetName = '';

  window.openKickModal = (userId, userName) => {
    if (myRole !== 'admin') return;
    kickTargetId   = userId;
    kickTargetName = userName;
    document.getElementById('kickModalTarget').textContent =
      `You are about to remove ${userName} from the household. Please provide a reason.`;
    document.getElementById('kickReason').value = '';
    document.getElementById('kickModal').style.display = 'flex';
    setTimeout(() => document.getElementById('kickReason').focus(), 50);
  };
  window.closeKickModal = () => {
    document.getElementById('kickModal').style.display = 'none';
    kickTargetId = null;
  };
  window.confirmKick = async () => {
    const reason = document.getElementById('kickReason').value.trim();
    if (!reason) { toast('Please enter a reason', 'error'); return; }
    if (!kickTargetId) return;
    try {
      const resp = await apiFetch(`/households/${householdId}/members/${kickTargetId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      closeKickModal();
      toast(resp.message || 'Member removed', 'success');
      // Refresh member list
      const household = await apiFetch('/households/' + householdId);
      members = household.members || [];
      renderMembers();
    } catch (err) {
      toast(err.message || 'Could not remove member', 'error');
    }
  };

  // =========================================================================
  // PURCHASES (Bug #4)
  // =========================================================================
  async function loadPurchases() {
    try {
      const { purchases: list } = await apiFetch('/households/' + householdId + '/purchases');
      purchases = list || [];
      renderPurchases();
    } catch (err) {
      console.warn('Purchases load failed:', err.message);
    }
  }

  function renderPurchases() {
    const wrap = document.getElementById('purchaseList');
    if (!wrap) return;
    if (purchases.length === 0) {
      wrap.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;font-size:0.9rem;">No shared purchases yet. Start one to split costs with your housemates.</p>';
      return;
    }
    wrap.innerHTML = purchases.map(p => {
      const pct = Math.min(100, (parseFloat(p.current_amount) / parseFloat(p.target_amount)) * 100);
      const statusChip = {
        open: '<span class="status-chip open">Open</span>',
        funded: '<span class="status-chip funded">Funded</span>',
        cancelled: '<span class="status-chip cancelled">Cancelled</span>'
      }[p.status] || '';
      const creatorIsMe = String(p.created_by) === String(user.id);
      const canCancel = p.status === 'open' && (creatorIsMe || myRole === 'admin');
      const canContribute = p.status === 'open';
      const canDelete = creatorIsMe || myRole === 'admin';
      const deleteBtn = canDelete
        ? `<button id="delete-purchase-btn-${p.id}" onclick="deletePurchase('${p.id}')" title="Delete purchase"
                   style="background:none;border:none;cursor:pointer;padding:4px;
                          color:#94a3b8;flex-shrink:0;line-height:0;transition:color .15s;"
                   onmouseover="this.style.color='#f87171'"
                   onmouseout="this.style.color='#94a3b8'">
             <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
           </button>`
        : '';

      return `
        <div class="purchase-item">
          <div class="purchase-head">
            <div>
              <span class="purchase-name">${escapeHtml(p.item_name)}</span>
              ${statusChip}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="purchase-meta">by ${escapeHtml(p.creator_name || 'Unknown')}</span>
              ${deleteBtn}
            </div>
          </div>
          ${p.description ? `<p class="purchase-desc">${escapeHtml(p.description)}</p>` : ''}
          <div class="purchase-progress">
            <div class="purchase-progress-bar" style="width:${pct.toFixed(1)}%;"></div>
          </div>
          <div class="purchase-numbers">
            £${parseFloat(p.current_amount).toFixed(2)}
            <span style="color:#94a3b8;"> / £${parseFloat(p.target_amount).toFixed(2)}</span>
            <span style="margin-left:8px;color:#94a3b8;">(${pct.toFixed(0)}%)</span>
          </div>
          <div class="purchase-actions">
            ${canContribute ? `<button class="btn-ghost-primary" onclick="openContributeModal('${p.id}','${escapeAttr(p.item_name)}',${(parseFloat(p.target_amount)-parseFloat(p.current_amount)).toFixed(2)})">Contribute</button>` : ''}
            ${canCancel ? `<button class="btn-ghost-danger" onclick="cancelPurchase('${p.id}')">Cancel</button>` : ''}
          </div>
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  window.openPurchaseModal = () => {
    document.getElementById('purchaseItemName').value = '';
    document.getElementById('purchaseDesc').value     = '';
    document.getElementById('purchaseTarget').value   = '';
    document.getElementById('purchaseModal').style.display = 'flex';
  };
  window.closePurchaseModal = () => { document.getElementById('purchaseModal').style.display = 'none'; };

  window.confirmCreatePurchase = async () => {
    const item_name     = document.getElementById('purchaseItemName').value.trim();
    const description   = document.getElementById('purchaseDesc').value.trim();
    const target_amount = parseFloat(document.getElementById('purchaseTarget').value);
    if (!item_name) { toast('Item name required', 'error'); return; }
    if (!Number.isFinite(target_amount) || target_amount <= 0) {
      toast('Target amount must be positive', 'error'); return;
    }
    try {
      await apiFetch('/households/' + householdId + '/purchases', {
        method: 'POST',
        body: JSON.stringify({ item_name, description, target_amount })
      });
      closePurchaseModal();
      toast('Purchase created', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not create purchase', 'error');
    }
  };

  let contribTarget = null;
  window.openContributeModal = (purchaseId, itemName, remaining) => {
    contribTarget = purchaseId;
    document.getElementById('contributeTitle').textContent = `Contribute to ${itemName}`;
    document.getElementById('contributeInfo').textContent  = `£${remaining} remaining.`;
    document.getElementById('contributeAmount').value = '';
    document.getElementById('contributeAmount').max   = remaining;
    document.getElementById('contributeModal').style.display = 'flex';
    setTimeout(() => document.getElementById('contributeAmount').focus(), 50);
  };
  window.closeContributeModal = () => {
    document.getElementById('contributeModal').style.display = 'none';
    contribTarget = null;
  };
  window.confirmContribute = async () => {
    if (!contribTarget) return;
    const amount = parseFloat(document.getElementById('contributeAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) { toast('Enter a positive amount', 'error'); return; }
    try {
      const resp = await apiFetch(
        `/households/${householdId}/purchases/${contribTarget}/contribute`,
        { method: 'POST', body: JSON.stringify({ amount }) }
      );
      closeContributeModal();
      toast(resp.purchase.status === 'funded' ? 'Target reached — fully funded!' : 'Contribution saved', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not contribute', 'error');
    }
  };
  window.cancelPurchase = async (purchaseId) => {
    if (!confirm('Cancel this purchase? Contributions are not automatically refunded.')) return;
    try {
      await apiFetch(`/households/${householdId}/purchases/${purchaseId}/cancel`, { method: 'POST' });
      toast('Purchase cancelled', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not cancel', 'error');
    }
  };
  window.deletePurchase = async (purchaseId) => {
    if (!confirm('Delete this purchase? This cannot be undone.')) return;
    const btn = document.getElementById(`delete-purchase-btn-${purchaseId}`);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
    try {
      await apiFetch(`/households/${householdId}/purchases/${purchaseId}`, { method: 'DELETE' });
      toast('Purchase deleted', 'success');
      purchases = purchases.filter(p => String(p.id) !== String(purchaseId));
      renderPurchases();
    } catch (err) {
      toast(err.message || 'Could not delete purchase', 'error');
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }
  };
  loadPurchases();

  // =========================================================================
  // =========================================================================
  // SHOPPING LIST — database-backed
  // =========================================================================
  let shopping       = [];
  let currentShopTab = 'tobuy';

  const renderShopping = () => {
    const list = document.getElementById('shoppingList');
    if (!list) return;
    const filtered = shopping.filter(i => i.status === currentShopTab);
    if (filtered.length === 0) {
      list.innerHTML = `<p style="color:#94a3b8;font-size:.85rem;text-align:center;padding:16px 0;">Nothing here yet.</p>`;
      return;
    }
    list.innerHTML = filtered.map(item => `
      <div class="shop-item ${item.status === 'purchased' ? 'purchased' : ''}">
        <div class="shop-item-left">
          <div class="shop-check ${item.status === 'purchased' ? 'checked' : ''}"
               onclick="toggleShopItem('${item.id}')">
            ${item.status === 'purchased' ? '<i data-lucide="check" style="width:14px"></i>' : ''}
          </div>
          <div>
            <label>${escapeHtml(item.name)}</label>
            ${item.status === 'purchased' && item.purchased_by_name
              ? `<div style="font-size:.72rem;color:#94a3b8;">by ${escapeHtml(item.purchased_by_name)}</div>`
              : item.added_by_name
              ? `<div style="font-size:.72rem;color:#94a3b8;">added by ${escapeHtml(item.added_by_name)}</div>`
              : ''}
          </div>
        </div>
        <button class="delete-btn" onclick="deleteShopItem('${item.id}')">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  const loadShopping = async () => {
    try {
      const data = await apiFetch('/households/' + householdId + '/shopping');
      shopping = data.items || [];
      renderShopping();
    } catch (err) {
      console.error('Shopping load failed:', err.message);
    }
  };

  window.switchShopTab = (tab) => {
    currentShopTab = tab;
    document.querySelectorAll('.s-tab').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderShopping();
  };

  window.toggleShopItem = async (id) => {
    try {
      // WS SHOPPING_TOGGLED will update the local state for everyone
      await apiFetch(`/households/${householdId}/shopping/${id}/toggle`, { method: 'PATCH' });
    } catch (err) { toast(err.message || 'Could not update item', 'error'); }
  };

  window.deleteShopItem = async (id) => {
    try {
      await apiFetch(`/households/${householdId}/shopping/${id}`, { method: 'DELETE' });
      shopping = shopping.filter(i => i.id !== id);
      renderShopping();
    } catch (err) { toast(err.message || 'Could not delete item', 'error'); }
  };

  window.addShoppingItem = async () => {
    const input = document.getElementById('shopInput');
    if (!input || !input.value.trim()) return;
    const name = input.value.trim();
    input.value = '';
    try {
      // Don't add locally — the SHOPPING_ADDED WebSocket broadcast handles
      // the update for everyone including the sender, avoiding duplicates.
      await apiFetch('/households/' + householdId + '/shopping', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    } catch (err) {
      input.value = name; // restore on failure
      toast(err.message || 'Could not add item', 'error');
    }
  };

  await loadShopping();

  // =========================================================================
  // WEBSOCKET — real-time updates from other housemates
  // =========================================================================
  (function connectWebSocket() {
    const token = getToken();
    if (!token || !householdId) return;

    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://')
      + window.location.host
      + '/ws?token=' + encodeURIComponent(token)
      + '&householdId=' + encodeURIComponent(householdId);

    const ws = new WebSocket(wsUrl);

    ws.addEventListener('message', async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {

        case 'TASK_TOGGLED': {
          // The broadcast includes the full updated assignees array so we
          // can update every client's state WITHOUT a re-fetch.
          // This prevents overwriting local state with stale server data
          // and eliminates the "assignee rotation" bug caused by re-fetches.
          const localTask = tasks.find(t => String(t.id) === String(msg.taskId));
          if (localTask && Array.isArray(msg.assignees)) {
            localTask.assignees = msg.assignees;
            // Update overall status (used by admin view)
            if (msg.status) localTask.status = msg.status;
            // Update this user's personal status
            const myEntry = msg.assignees.find(a => String(a.id) === String(user.id));
            if (myEntry) {
              localTask.my_status = myEntry.completed ? 'completed' : 'pending';
              localTask.my_proof_url = myEntry.proof_url || null;
            }
          }
          renderChores();
          break;
        }

        case 'TASK_CREATED':
        case 'TASK_ASSIGNED':
        case 'TASK_DELETED': {
          // These events change assignment structure so a re-fetch is needed
          try {
            tasks = await apiFetch('/households/' + householdId + '/tasks');
            localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
            renderChores();
          } catch (_) {}
          break;
        }

        case 'BILL_CREATED':
        case 'BILL_PAID':
        case 'BILL_DELETED':
          toast('A bill was updated', 'info');
          break;

        case 'PURCHASE_CREATED':
        case 'PURCHASE_UPDATED':
        case 'PURCHASE_CANCELLED':
        case 'PURCHASE_DELETED':
          try { await loadPurchases(); } catch (_) {}
          break;

        case 'SHOPPING_ADDED': {
          shopping.unshift(msg.item);
          renderShopping();
          break;
        }
        case 'SHOPPING_TOGGLED': {
          const idx = shopping.findIndex(i => i.id === msg.item.id);
          if (idx !== -1) { shopping[idx] = { ...shopping[idx], ...msg.item }; renderShopping(); }
          break;
        }
        case 'SHOPPING_DELETED': {
          shopping = shopping.filter(i => i.id !== msg.itemId);
          renderShopping();
          break;
        }
      }
    });

    ws.addEventListener('error', () => {});
    ws.addEventListener('close', () => {
      // Reconnect after 3 seconds if the connection drops
      setTimeout(connectWebSocket, 3000);
    });
  })();

});

// --- helpers ---
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return String(s || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
