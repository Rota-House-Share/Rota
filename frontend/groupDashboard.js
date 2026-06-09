// =============================================================================
// Group Dashboard — chores, members (with kick), shopping, purchases
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

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
  } catch (err) {
    console.error('Tasks load failed:', err.message);
    tasks = JSON.parse(localStorage.getItem('rota_tasks_' + householdId)) || [];
    renderChores();
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
      const amAssigned = t.am_assigned === true;
      // Admins aren't assigned so use overall task status for the done visual
      const myDone     = myRole === 'admin'
        ? (t.status || 'pending') === 'completed'
        : myStatus === 'completed';
      const hasProof   = !!pendingProofs[t.id];


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

      const completionLabel = myDone
        ? `<span style="font-size:.75rem;color:#43d9a2;margin-left:4px;">✓ Done</span>`
        : '';

      // Proof photo preview label (after capture, before submit)
      const proofPreview = hasProof
        ? `<span style="font-size:.72rem;color:#6c63ff;margin-left:4px;display:flex;align-items:center;gap:3px;">
             <i data-lucide="image" style="width:11px;height:11px;"></i> Photo ready
           </span>`
        : '';

      // Checkbox — enabled only after photo captured (or if already done)
      const checkClass   = myDone ? 'chore-check checked' : 'chore-check';
      const checkContent = myDone ? '<i data-lucide="check" style="width:14px"></i>' : '';
      let checkAttr = '';
      if (myDone) {
        checkAttr = 'style="cursor:default;"';
      } else if (amAssigned && hasProof) {
        checkAttr = `onclick="submitTaskCompletion('${t.id}')" style="cursor:pointer;" title="Click to mark complete"`;
      } else if (amAssigned && !hasProof) {
        checkAttr = `style="opacity:.35;cursor:not-allowed;" title="Take a photo first"`;
      } else {
        checkAttr = `style="opacity:.25;cursor:not-allowed;" title="You are not assigned to this task"`;
      }

      // Camera icon — only for assigned users on pending tasks
      const cameraBtn = amAssigned && !myDone
        ? `<input type="file" accept="image/*" capture="environment"
                  id="proof-input-${t.id}" style="display:none;"
                  onchange="handleProofCapture('${t.id}', this)">
           <button onclick="document.getElementById('proof-input-${t.id}').click()"
                   id="camera-btn-${t.id}"
                   title="${hasProof ? 'Retake photo' : 'Take proof photo'}"
                   style="background:none;border:none;cursor:pointer;padding:4px;
                          color:${hasProof ? '#43d9a2' : '#6c63ff'};flex-shrink:0;line-height:0;transition:color .15s;">
             <i data-lucide="${hasProof ? 'image-check' : 'camera'}" style="width:16px;height:16px;"></i>
           </button>`
        : '';

      // Admin: photo icon — collect all assignees who uploaded proof
      const proofsForTask = assignees.filter(a => a.proof_url);
      if (proofsForTask.length > 0) {
        window._proofData = window._proofData || {};
        window._proofData[t.id] = { title: t.title, proofs: proofsForTask };
      }
      const proofViewBtn = myRole === 'admin' && proofsForTask.length > 0
        ? `<button onclick="openProofModal('${t.id}')"
                   title="View proof photos (${proofsForTask.length})"
                   style="background:none;border:none;cursor:pointer;padding:4px;
                          color:#6c63ff;flex-shrink:0;line-height:0;transition:color .15s;"
                   onmouseover="this.style.color='#4f46e5'"
                   onmouseout="this.style.color='#6c63ff'">
             <i data-lucide="images" style="width:16px;height:16px;"></i>
           </button>`
        : '';

      // Delete button — admins only
      const deleteBtn = myRole === 'admin'
        ? `<button onclick="deleteChore('${t.id}')" title="Delete task"
                   style="background:none;border:none;cursor:pointer;padding:4px;
                          color:#94a3b8;flex-shrink:0;line-height:0;transition:color .15s;"
                   onmouseover="this.style.color='#f87171'"
                   onmouseout="this.style.color='#94a3b8'">
             <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
           </button>`
        : '';

      return `
        <div class="chore-item ${myDone ? 'done' : ''}" data-id="${t.id}">
          <div class="${checkClass}" ${checkAttr}>
            ${checkContent}
          </div>
          <div class="chore-info" style="flex:1;min-width:0;">
            <span class="chore-title">${escapeHtml(t.title)}</span>
            <div class="chore-meta" style="display:flex;align-items:center;gap:3px;margin-top:4px;flex-wrap:wrap;">
              ${avatarRow}
              ${completionLabel}
              ${proofPreview}
            </div>
          </div>
          ${cameraBtn}
          ${proofViewBtn}
          ${deleteBtn}
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Proof photo modal (admin only) ───────────────────────────────────────
  // Inject modal HTML once
  if (!document.getElementById('proofModal')) {
    const el = document.createElement('div');
    el.id = 'proofModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = `
      <div style="background:var(--bg-card,#1e1e2e);border-radius:16px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.4);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;background:var(--bg-card,#1e1e2e);z-index:1;">
          <span id="proofModalTitle" style="font-size:15px;font-weight:600;color:var(--text-primary,#e2e8f0);"></span>
          <button onclick="closeProofModal()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;">✕</button>
        </div>
        <div id="proofModalBody" style="padding:14px 18px;display:flex;flex-direction:column;gap:16px;"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closeProofModal(); });
  }

  window.openProofModal = (taskId) => {
    const data = (window._proofData || {})[taskId];
    if (!data) return;
    document.getElementById('proofModalTitle').textContent = data.title;
    document.getElementById('proofModalBody').innerHTML = data.proofs.map(p => {
      const completedDate = p.completed_at ? new Date(p.completed_at) : null;
      const completedStr  = completedDate
        ? completedDate.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ' ' +
          completedDate.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })
        : '—';
      return `
        <div style="border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;">
          <div style="width:100%;height:200px;background:rgba(255,255,255,.06);
                      display:flex;flex-direction:column;align-items:center;justify-content:center;
                      color:#94a3b8;overflow:hidden;">
            <img src="${escapeAttr(p.proof_url)}" alt="Proof"
                 style="width:100%;height:100%;object-fit:cover;display:block;"
                 onerror="this.style.display='none';this.parentElement.innerHTML='<i data-lucide=&quot;camera&quot; style=&quot;width:32px;height:32px;&quot;></i><span style=&quot;font-size:13px;margin-top:8px;&quot;>Proof photo</span>'">
          </div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;">
              <span style="color:#94a3b8;">Assigned to</span>
              <span style="color:var(--text-primary,#e2e8f0);font-weight:600;">${escapeHtml(p.name)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;">
              <span style="color:#94a3b8;">Completed</span>
              <span style="color:var(--text-primary,#e2e8f0);font-weight:600;">${completedStr}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;">
              <span style="color:#94a3b8;">Status</span>
              <span style="color:#43d9a2;font-weight:600;">Done</span>
            </div>
          </div>
        </div>`;
    }).join('');
    document.getElementById('proofModal').style.display = 'flex';
  };
  window.closeProofModal = () => {
    document.getElementById('proofModal').style.display = 'none';
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

  // Called when user captures a photo — stores it locally, enables the checkbox
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  window.handleProofCapture = async (id, input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    // Option 1: validate type client-side before doing anything
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast('Only JPEG, PNG or WebP photos allowed', 'error');
      return;
    }

    const compressed = await compressImage(file);
    pendingProofs[id] = compressed;
    renderChores();
  };

  // Called when the (now-enabled) checkbox is clicked after photo is captured
  window.submitTaskCompletion = async (id) => {
    const file = pendingProofs[id];
    if (!file) { toast('Take a photo first', 'error'); return; }

    const btn = document.getElementById(`camera-btn-${id}`);
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    try {
      const form = new FormData();
      form.append('proof', file);

      const tkn = getToken();
      const res = await fetch(`/api/tasks/${id}/toggle`, {
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

      delete pendingProofs[id];

      const localTask = tasks.find(t => String(t.id) === String(id));
      if (localTask) {
        localTask.my_status = myCompleted ? 'completed' : 'pending';
        if (Array.isArray(updatedAssignees)) localTask.assignees = updatedAssignees;
      }
      renderChores();
      toast('Task marked complete', 'success');
    } catch (err) {
      toast(err.message || 'Could not update task', 'error');
    } finally {
      // Option 2: always re-enable the button regardless of outcome
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
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
    const title   = titleEl.value.trim();
    if (!title) { toast('Enter a task title', 'error'); return; }

    // Collect all ticked checkboxes as an array of UUIDs
    const checked  = document.querySelectorAll('#choreAssignees input[type="checkbox"]:checked');
    const assignees = Array.from(checked).map(cb => cb.value);

    try {
      await apiFetch('/households/' + householdId + '/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, assigned_to: assignees.length > 0 ? assignees : null })
      });
      titleEl.value = '';
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
  // SHOPPING LIST (local only, unchanged)
  // =========================================================================
  let shopping       = JSON.parse(localStorage.getItem('rota_shopping')) || [];
  let currentShopTab = 'tobuy';

  const renderShopping = () => {
    const list = document.getElementById('shoppingList');
    if (!list) return;
    const filtered = shopping.filter(i => i.status === currentShopTab);
    list.innerHTML = filtered.map(item => `
      <div class="shop-item ${item.status === 'purchased' ? 'purchased' : ''}">
        <div class="shop-item-left">
          <div class="shop-check ${item.status === 'purchased' ? 'checked' : ''}" onclick="toggleShopItem(${item.id})">
            ${item.status === 'purchased' ? '<i data-lucide="check" style="width:14px"></i>' : ''}
          </div>
          <label>${escapeHtml(item.name)}</label>
        </div>
        <button class="delete-btn" onclick="deleteShopItem(${item.id})">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    localStorage.setItem('rota_shopping', JSON.stringify(shopping));
  };
  window.switchShopTab = (tab) => {
    currentShopTab = tab;
    document.querySelectorAll('.s-tab').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderShopping();
  };
  window.toggleShopItem = (id) => {
    const item = shopping.find(i => i.id === id);
    if (item) { item.status = item.status === 'tobuy' ? 'purchased' : 'tobuy'; renderShopping(); }
  };
  window.deleteShopItem = (id) => {
    shopping = shopping.filter(i => i.id !== id);
    renderShopping();
  };
  window.addShoppingItem = () => {
    const input = document.getElementById('shopInput');
    if (!input || !input.value.trim()) return;
    shopping.push({ id: Date.now(), name: input.value.trim(), status: 'tobuy' });
    input.value = '';
    renderShopping();
  };
  renderShopping();

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
