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
    // Use my_status (per-user) for tab filtering — not the overall task status.
    // This means each person sees tasks in Done/To Do based on THEIR own completion.
    const filtered = tasks.filter(t => {
      const s = t.my_status || t.status || 'pending';
      return currentChoreTab === 'pending' ? s !== 'completed' : s === 'completed';
    });
    if (filtered.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">No tasks here yet.</p>';
      return;
    }
    list.innerHTML = filtered.map(t => {
      const assignees  = Array.isArray(t.assignees) ? t.assignees : [];
      // Use server-provided per-user fields (from the new getTasks query)
      const myStatus   = t.my_status || 'pending';
      const amAssigned = t.am_assigned === true;
      const myDone     = myStatus === 'completed';
      const taskDone   = myDone; // for this user, done = their own row is completed

      // Who completed it (sorted by completed_at)
      const completedBy    = assignees.filter(a => a.completed)
        .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
      const firstCompleter = completedBy.length > 0 ? completedBy[0] : null;

      // Avatar row — green = that person has completed, purple = still pending
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

      // "Done by X" label — shown on completed tab
      const completionLabel = myDone && firstCompleter
        ? `<span style="font-size:.75rem;color:#43d9a2;margin-left:4px;">
             ✓ Done by ${escapeHtml(firstCompleter.name)}
           </span>`
        : '';

      // Checkbox — only assigned members can tick
      const checkClass   = myDone ? 'chore-check checked' : 'chore-check';
      const checkContent = myDone ? '<i data-lucide="check" style="width:14px"></i>' : '';
      const checkAction  = amAssigned
        ? `onclick="toggleChore('${t.id}')" style="cursor:pointer;"`
        : `title="You are not assigned to this task"
           style="opacity:.35;cursor:not-allowed;"`;

      // Delete button — admins only
      const deleteBtn = myRole === 'admin'
        ? `<button onclick="deleteChore('${t.id}')" title="Delete task" style="
              background:none;border:none;cursor:pointer;padding:4px;
              color:#94a3b8;flex-shrink:0;line-height:0;transition:color .15s;"
              onmouseover="this.style.color='#f87171'"
              onmouseout="this.style.color='#94a3b8'">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>`
        : '';

      return `
        <div class="chore-item ${taskDone ? 'done' : ''}" data-id="${t.id}">
          <div class="${checkClass}" ${checkAction}>
            ${checkContent}
          </div>
          <div class="chore-info" style="flex:1;min-width:0;">
            <span class="chore-title">${escapeHtml(t.title)}</span>
            <div class="chore-meta" style="display:flex;align-items:center;gap:3px;margin-top:4px;flex-wrap:wrap;">
              ${avatarRow}
              ${completionLabel}
            </div>
          </div>
          ${deleteBtn}
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

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

  // FIX (Bug #1): No more optimistic flip.
  // Previously we flipped UI state, called the API, then re-fetched.
  // If the API call silently failed (dead UUID, expired token, local_
  // prefix task) the refetch reverted the UI, which looked to users
  // like "nothing happened". Now:
  //   1. Disable the checkbox so the user can't double-click.
  //   2. Call the new /toggle endpoint which flips in either direction.
  //   3. Show a toast with the result (success OR error — no silence).
  //   4. Re-fetch fresh state so rotation advances are reflected.
  // If the task was created offline (local_ prefix), skip the network
  // call and just flip the local task — the server doesn't know it yet.
  window.toggleChore = async (id) => {
    const idx = tasks.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return;
    const task = tasks[idx];

    // Offline/local task — handle purely in localStorage
    if (String(id).startsWith('local_')) {
      task.status = task.status === 'completed' ? 'pending' : 'completed';
      localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
      renderChores();
      return;
    }

    try {
      // Server returns { status, myCompleted, assignees }
      // assignees contains every member's updated completed flag
      // Assignment user_ids are NEVER changed by this call
      const result = await apiFetch(`/tasks/${id}/toggle`, { method: 'PATCH' });
      if (!result) return;

      const { myCompleted, assignees: updatedAssignees } = result;

      // Apply the server's truth directly to the local task —
      // no re-fetch needed (avoids overwriting with stale data)
      const localTask = tasks.find(t => String(t.id) === String(id));
      if (localTask) {
        // Update per-user status
        localTask.my_status = myCompleted ? 'completed' : 'pending';
        // Replace assignees array with server's version (completion flags updated)
        if (Array.isArray(updatedAssignees)) {
          localTask.assignees = updatedAssignees;
        }
      }
      renderChores();
      toast(myCompleted ? '✅ Marked done' : 'Marked pending', 'success');
    } catch (err) {
      toast(err.message || 'Could not update task', 'error');
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
      return `
        <div class="purchase-item">
          <div class="purchase-head">
            <div>
              <span class="purchase-name">${escapeHtml(p.item_name)}</span>
              ${statusChip}
            </div>
            <span class="purchase-meta">by ${escapeHtml(p.creator_name || 'Unknown')}</span>
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
            // Replace assignees with updated completion states
            localTask.assignees = msg.assignees;
            // Update this user's my_status from their entry in the updated array
            const myEntry = msg.assignees.find(a => String(a.id) === String(user.id));
            if (myEntry) {
              localTask.my_status = myEntry.completed ? 'completed' : 'pending';
            }
            // am_assigned doesn't change — completion never changes assignment
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
