import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  canManageTargetRole,
  canManageUser,
  DirectoryEntry,
  getRoleRank,
  isDeveloperRole,
  RoleDefinition,
  TaskDoc,
} from '../types';
import { randomTempPassword } from '../utils/crypto';

interface UsersViewProps {
  me: DirectoryEntry;
  directory: DirectoryEntry[];
  roles: RoleDefinition[];
  branches: string[];
  locations: string[];
  tasks: TaskDoc[];
  boundEmpIds?: string[] | null;
  onCreateUser: (params: {
    empId: string;
    name: string;
    password: string;
    role: string;
    branch: string;
    location: string;
  }) => Promise<void>;
  onUpdateUser: (params: {
    target: DirectoryEntry;
    name: string;
    role: string;
    branch: string;
    location: string;
  }) => Promise<void>;
  onResetPassword: (target: DirectoryEntry, newPassword: string) => Promise<void>;
  onDeleteUser: (target: DirectoryEntry) => Promise<void>;
}

type LoginFilter = 'All' | 'Active' | 'Pending';

export const UsersView: React.FC<UsersViewProps> = ({
  me,
  directory,
  roles,
  branches,
  locations,
  tasks,
  boundEmpIds,
  onCreateUser,
  onUpdateUser,
  onResetPassword,
  onDeleteUser,
}) => {
  const [queryText, setQueryText] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [branchFilter, setBranchFilter] = useState('All');
  const [locFilter, setLocFilter] = useState('All');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('All');
  const [busy, setBusy] = useState(false);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addPw, setAddPw] = useState('');
  const [addRole, setAddRole] = useState('Process Coordinator');
  const [addBranch, setAddBranch] = useState(branches[0] || 'MIS');
  const [addLoc, setAddLoc] = useState(locations[0] || 'Bengaluru Office');
  const [addErr, setAddErr] = useState('');

  // Edit modal
  const [editTarget, setEditTarget] = useState<DirectoryEntry | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editBranch, setEditBranch] = useState('');
  const [editLoc, setEditLoc] = useState('');
  const [editErr, setEditErr] = useState('');

  // Reset password modal
  const [pwTarget, setPwTarget] = useState<DirectoryEntry | null>(null);
  const [resetPwVal, setResetPwVal] = useState('');
  const [pwErr, setPwErr] = useState('');

  // Delete modal
  const [delTarget, setDelTarget] = useState<DirectoryEntry | null>(null);
  const [delErr, setDelErr] = useState('');

  const isDev = isDeveloperRole(me.role);

  const allRoleNames = useMemo(
    () =>
      Array.from(new Set([...roles.map((r) => r.name), ...directory.map((d) => d.role)])).sort(
        (a, b) => getRoleRank(b) - getRoleRank(a)
      ),
    [roles, directory]
  );

  const allBranches = useMemo(
    () =>
      Array.from(
        new Set([...branches, ...directory.map((d) => d.branch).filter(Boolean)])
      ).sort((a, b) => a.localeCompare(b)),
    [branches, directory]
  );

  const allLocations = useMemo(
    () =>
      Array.from(
        new Set([...locations, ...directory.map((d) => d.location).filter(Boolean)])
      ).sort((a, b) => a.localeCompare(b)),
    [locations, directory]
  );

  // Roles this signed-in user is strictly permitted to assign
  const assignableRoleNames = useMemo(
    () => allRoleNames.filter((r) => canManageTargetRole(me.role, r)),
    [allRoleNames, me.role]
  );

  const boundSet = useMemo(() => (boundEmpIds ? new Set(boundEmpIds) : null), [boundEmpIds]);

  const isDirectLoginActive = (u: DirectoryEntry): boolean => {
    if (boundSet) return boundSet.has(u.empId);
    return Boolean(u.authUid);
  };

  // Count currently open tasks waiting on each employee name
  const openTasksByName = useMemo(() => {
    const map: Record<string, number> = {};
    tasks.forEach((t) => {
      if (t.stage < t.path.length && t.status !== 'closed') {
        const assignee = t.path[t.stage];
        if (assignee) map[assignee] = (map[assignee] || 0) + 1;
      }
    });
    return map;
  }, [tasks]);

  const pendingActivationUsers = useMemo(
    () =>
      directory.filter(
        (u) =>
          u.active &&
          u.empId !== 'developer' &&
          canManageUser(me, u) &&
          !isDirectLoginActive(u)
      ),
    [directory, me, boundSet]
  );

  const stats = useMemo(() => {
    let directCount = 0;
    let pendingCount = 0;
    let totalOpenTasks = 0;
    let assigneesWithOpen = 0;
    directory.forEach((u) => {
      const direct = isDirectLoginActive(u);
      if (direct || u.empId === 'developer') directCount++;
      else pendingCount++;
      const openCnt = openTasksByName[u.name] || 0;
      totalOpenTasks += openCnt;
      if (openCnt > 0) assigneesWithOpen++;
    });
    return {
      total: directory.length,
      directCount,
      pendingCount,
      totalOpenTasks,
      assigneesWithOpen,
    };
  }, [directory, boundSet, openTasksByName]);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return directory
      .filter((u) => {
        if (q) {
          const hay = `${u.name} ${u.empId} ${u.role} ${u.branch} ${u.location}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (roleFilter !== 'All' && u.role !== roleFilter) return false;
        if (branchFilter !== 'All' && u.branch !== branchFilter) return false;
        if (locFilter !== 'All' && u.location !== locFilter) return false;
        if (loginFilter !== 'All') {
          const direct = isDirectLoginActive(u) || u.empId === 'developer';
          if (loginFilter === 'Active' && !direct) return false;
          if (loginFilter === 'Pending' && direct) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          getRoleRank(b.role) - getRoleRank(a.role) || a.name.localeCompare(b.name)
      );
  }, [directory, queryText, roleFilter, branchFilter, locFilter, loginFilter, boundSet]);

  const hasFilters =
    queryText.trim() !== '' ||
    roleFilter !== 'All' ||
    branchFilter !== 'All' ||
    locFilter !== 'All' ||
    loginFilter !== 'All';

  const resetFilters = () => {
    setQueryText('');
    setRoleFilter('All');
    setBranchFilter('All');
    setLocFilter('All');
    setLoginFilter('All');
  };

  const nameTaken = (name: string, excludeEmpId: string) =>
    directory.some(
      (u) => u.name.toLowerCase() === name.toLowerCase() && u.empId !== excludeEmpId
    );

  const openAdd = () => {
    if (!assignableRoleNames.length) return;
    setAddId('');
    setAddName('');
    setAddPw(randomTempPassword());
    setAddRole(
      assignableRoleNames.includes('Process Coordinator')
        ? 'Process Coordinator'
        : assignableRoleNames[0]
    );
    setAddBranch(branches[0] || 'MIS');
    setAddLoc(locations[0] || 'Bengaluru Office');
    setAddErr('');
    setShowAdd(true);
  };

  const handleAdd = async () => {
    const k = addId.trim().toLowerCase();
    const n = addName.trim();
    if (!/^[a-z0-9._]{3,20}$/.test(k)) {
      return setAddErr('User ID: 3 to 20 letters, numbers, dots or underscores.');
    }
    if (directory.some((d) => d.empId === k)) {
      return setAddErr('That user ID already exists.');
    }
    if (!n || nameTaken(n, '')) {
      return setAddErr('Enter a unique full name.');
    }
    if (addPw.length < 6) {
      return setAddErr('Password needs 6 or more characters.');
    }
    if (!canManageTargetRole(me.role, addRole)) {
      return setAddErr('You can only assign roles strictly lower than your own role.');
    }
    setBusy(true);
    setAddErr('');
    try {
      await onCreateUser({
        empId: k,
        name: n,
        password: addPw,
        role: addRole,
        branch: addBranch,
        location: addLoc,
      });
      setShowAdd(false);
    } catch (err: unknown) {
      setAddErr(err instanceof Error ? err.message : 'Unable to create user.');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (u: DirectoryEntry) => {
    if (!canManageUser(me, u)) return;
    setEditTarget(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditBranch(u.branch);
    setEditLoc(u.location);
    setEditErr('');
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!canManageUser(me, editTarget)) {
      return setEditErr('You can only edit users with a role strictly lower than your own.');
    }
    if (!canManageTargetRole(me.role, editRole)) {
      return setEditErr('You cannot assign your own role or an upper role.');
    }
    if (
      editTarget.role === 'Developer' &&
      editRole !== 'Developer' &&
      directory.filter((x) => x.active && x.role === 'Developer').length < 2
    ) {
      return setEditErr('At least one Developer account must remain.');
    }
    const n = editName.trim();
    if (!n) return setEditErr('Name is required.');
    if (nameTaken(n, editTarget.empId)) return setEditErr('That name is already used.');
    setBusy(true);
    setEditErr('');
    try {
      await onUpdateUser({
        target: editTarget,
        name: n,
        role: editRole,
        branch: editBranch,
        location: editLoc,
      });
      setEditTarget(null);
    } catch (err: unknown) {
      setEditErr(err instanceof Error ? err.message : 'Unable to update user.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPw = async () => {
    if (!pwTarget) return;
    if (!canManageUser(me, pwTarget)) {
      return setPwErr('You can only reset passwords for users strictly lower than your own role.');
    }
    if (resetPwVal.length < 6) return setPwErr('Use at least 6 characters.');
    setBusy(true);
    setPwErr('');
    try {
      await onResetPassword(pwTarget, resetPwVal);
      setPwTarget(null);
    } catch (err: unknown) {
      setPwErr(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!delTarget) return;
    if (delTarget.empId === me.empId) {
      return setDelErr('You cannot delete the account you are signed in with.');
    }
    if (!canManageUser(me, delTarget)) {
      return setDelErr('You can only delete users with a role strictly lower than your own.');
    }
    if (
      delTarget.role === 'Developer' &&
      directory.filter((x) => x.active && x.role === 'Developer').length < 2
    ) {
      return setDelErr('At least one Developer account must remain.');
    }
    setBusy(true);
    setDelErr('');
    try {
      await onDeleteUser(delTarget);
      setDelTarget(null);
    } catch (err: unknown) {
      setDelErr(err instanceof Error ? err.message : 'Unable to delete user.');
    } finally {
      setBusy(false);
    }
  };

  const delOpenTasks = delTarget
    ? tasks.filter((t) => t.stage < t.path.length && t.path[t.stage] === delTarget.name).length
    : 0;

  return (
    <div className="view on" id="v-usr">
      {/* Header & Filter Control Panel */}
      <section className="usr-panel" aria-label="User management controls">
        <div className="usr-hd">
          <div className="usr-title-wrap">
            <h3 className="usr-title">User management</h3>
            <div className="usr-meta-line">
              <span>{directory.length} accounts</span>
              <span aria-hidden="true">·</span>
              <span>{allRoleNames.length} roles</span>
              <span aria-hidden="true">·</span>
              <span>{allLocations.length} locations</span>
            </div>
          </div>

          <div className="usr-actions">
            {hasFilters && (
              <button
                className="usr-btn usr-btn-ghost"
                type="button"
                onClick={resetFilters}
              >
                Reset filters
              </button>
            )}
            {assignableRoleNames.length > 0 && (
              <button
                className="usr-btn usr-btn-primary"
                id="uadd"
                type="button"
                onClick={openAdd}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add user
              </button>
            )}
          </div>
        </div>

        <div className="usr-body">
          <div className="usr-filters">
            <div className="usr-field usr-field-search">
              <label htmlFor="uq">Search</label>
              <input
                id="uq"
                type="search"
                placeholder="Name, @user ID, role, branch or location..."
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
              />
            </div>

            <div className="usr-field">
              <label htmlFor="ur">Role</label>
              <select
                id="ur"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="All">All roles</option>
                {allRoleNames.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="usr-field">
              <label htmlFor="ub">Branch</label>
              <select
                id="ub"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="All">All branches</option>
                {allBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="usr-field">
              <label htmlFor="ul">Location</label>
              <select
                id="ul"
                value={locFilter}
                onChange={(e) => setLocFilter(e.target.value)}
              >
                <option value="All">All locations</option>
                {allLocations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div className="usr-field">
              <label htmlFor="ust">Sign-in status</label>
              <select
                id="ust"
                value={loginFilter}
                onChange={(e) => setLoginFilter(e.target.value as LoginFilter)}
              >
                <option value="All">All statuses</option>
                <option value="Active">Direct login active</option>
                <option value="Pending">Needs activation</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Card Summary Strip */}
      <div className="usr-stats" aria-label="Account summary metrics">
        <button
          type="button"
          className={`usr-stat${loginFilter === 'All' && !hasFilters ? ' is-sel' : ''}`}
          onClick={resetFilters}
        >
          <span className="usr-stat-lbl">Total accounts</span>
          <b className="usr-stat-val">{stats.total}</b>
          <span className="usr-stat-sub">
            {filtered.length} shown in table
          </span>
        </button>

        <button
          type="button"
          className={`usr-stat${loginFilter === 'Active' ? ' is-sel' : ''}`}
          onClick={() => setLoginFilter((prev) => (prev === 'Active' ? 'All' : 'Active'))}
        >
          <span className="usr-stat-lbl">Direct login active</span>
          <b className="usr-stat-val usr-val-ok">{stats.directCount}</b>
          <span className="usr-stat-sub">User ID + password ready</span>
        </button>

        <button
          type="button"
          className={`usr-stat${loginFilter === 'Pending' ? ' is-sel' : ''}`}
          onClick={() => setLoginFilter((prev) => (prev === 'Pending' ? 'All' : 'Pending'))}
        >
          <span className="usr-stat-lbl">Needs activation</span>
          <b className={`usr-stat-val${stats.pendingCount > 0 ? ' usr-val-warn' : ''}`}>
            {stats.pendingCount}
          </b>
          <span className="usr-stat-sub">
            {stats.pendingCount > 0 ? 'Click to filter pending' : 'All accounts activated'}
          </span>
        </button>

        <div className="usr-stat usr-stat-static">
          <span className="usr-stat-lbl">Open workload</span>
          <b className="usr-stat-val">{stats.totalOpenTasks}</b>
          <span className="usr-stat-sub">
            Across {stats.assigneesWithOpen} active assignee{stats.assigneesWithOpen === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* One-time Activation Notice */}
      {pendingActivationUsers.length > 0 && (
        <div className="usr-notice" role="status">
          <div className="usr-notice-txt">
            <b>
              {pendingActivationUsers.length} account
              {pendingActivationUsers.length > 1 ? 's' : ''} awaiting one-time sign-in activation
            </b>
            <span>
              {' '}
              ({pendingActivationUsers.map((u) => `@${u.empId}`).join(', ')}). Click{' '}
              <b>Activate login</b> on each row and set their password so they can sign in directly
              with User ID + Password.
            </span>
          </div>
          {loginFilter !== 'Pending' && (
            <button
              type="button"
              className="usr-btn usr-btn-secondary"
              onClick={() => setLoginFilter('Pending')}
            >
              Show pending
            </button>
          )}
        </div>
      )}

      {/* Structured Single-Row Directory Table */}
      <section className="usr-table-card" aria-label="User directory table">
        <div className="usr-table-bar">
          <div className="usr-table-title">
            <h4>Directory</h4>
            <span className="usr-table-count">
              Showing {filtered.length} of {directory.length}
            </span>
          </div>
          <div className="usr-table-hint">
            {isDev
              ? 'Full Developer access across all roles'
              : `Hierarchy scope: ${me.role} manages strictly lower roles`}
          </div>
        </div>

        <div className="usr-tbl-wrap m-card-tbl">
          <table id="ut" className="usr-table">
            <thead>
              <tr>
                <th className="usr-col-idx">#</th>
                <th className="usr-col-user">User</th>
                <th className="usr-col-id">User ID</th>
                <th className="usr-col-role">Role</th>
                <th className="usr-col-branch">Branch</th>
                <th className="usr-col-loc">Location</th>
                <th className="usr-col-join">Joined</th>
                <th className="usr-col-tasks">Tasks</th>
                <th className="usr-col-status">Sign-in</th>
                <th className="usr-col-acts">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="usr-empty-row">
                  <td colSpan={10}>
                    <div className="usr-empty">
                      <p>No user accounts match the current filters.</p>
                      <div className="usr-empty-acts">
                        {hasFilters && (
                          <button
                            type="button"
                            className="usr-btn usr-btn-secondary"
                            onClick={resetFilters}
                          >
                            Reset filters
                          </button>
                        )}
                        {assignableRoleNames.length > 0 && (
                          <button
                            type="button"
                            className="usr-btn usr-btn-primary"
                            onClick={openAdd}
                          >
                            Add user
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((u, idx) => {
                  const manageable = canManageUser(me, u);
                  const isSelf = u.empId === me.empId;
                  const directActive = isDirectLoginActive(u);
                  const needsActivation = u.empId !== 'developer' && !directActive;
                  const openCount = openTasksByName[u.name] || 0;

                  return (
                    <tr
                      key={u.docId}
                      className={isSelf ? 'usr-row-self' : undefined}
                    >
                      <td className="usr-col-idx usr-num" data-label="#">
                        {String(idx + 1).padStart(2, '0')}
                      </td>

                      <td data-label="User" className="m-card-head usr-col-user">
                        <div className="usr-user-cell">
                          <span
                            className={`av usr-av${u.photoUrl ? ' ph' : ''}`}
                            style={{
                              backgroundImage: u.photoUrl ? `url("${u.photoUrl}")` : undefined,
                            }}
                          >
                            {u.name[0]}
                          </span>
                          <div className="usr-name-wrap">
                            <span className="usr-name" title={u.name}>
                              {u.name}
                            </span>
                            <span className="usr-mob-id">@{u.empId}</span>
                          </div>
                        </div>
                      </td>

                      <td data-label="User ID" className="usr-col-id usr-mono">
                        @{u.empId}
                      </td>

                      <td data-label="Role" className="usr-col-role">
                        <span className={getRoleRank(u.role) >= 3 ? 'usr-role-hi' : 'usr-role'}>
                          {u.role}
                        </span>
                      </td>

                      <td data-label="Branch" className="usr-col-branch">
                        {u.branch || '—'}
                      </td>

                      <td data-label="Location" className="usr-col-loc">
                        {u.location || '—'}
                      </td>

                      <td data-label="Joined" className="usr-col-join usr-num">
                        {u.joinedAt || '—'}
                      </td>

                      <td data-label="Open tasks" className="usr-col-tasks usr-num">
                        {openCount > 0 ? (
                          <span className="usr-tasks-open">{openCount}</span>
                        ) : (
                          <span className="usr-muted">0</span>
                        )}
                      </td>

                      <td data-label="Sign-in" className="usr-col-status">
                        {needsActivation ? (
                          <span className="usr-st usr-st-warn">Needs activation</span>
                        ) : directActive ? (
                          <span className="usr-st usr-st-ok">Active</span>
                        ) : (
                          <span className="usr-st usr-st-dev">System</span>
                        )}
                      </td>

                      <td data-label="Actions" className="m-card-acts usr-col-acts">
                        {manageable ? (
                          <div className="usr-acts-wrap">
                            <button
                              className="usr-act-btn"
                              type="button"
                              onClick={() => openEdit(u)}
                            >
                              Edit
                            </button>
                            <button
                              className={
                                needsActivation
                                  ? 'usr-act-btn usr-act-primary'
                                  : 'usr-act-btn'
                              }
                              type="button"
                              onClick={() => {
                                setPwTarget(u);
                                setResetPwVal('');
                                setPwErr('');
                              }}
                            >
                              {needsActivation ? 'Activate login' : 'Reset password'}
                            </button>
                            {!isSelf && (
                              <button
                                className="usr-act-btn usr-act-danger"
                                type="button"
                                onClick={() => {
                                  setDelTarget(u);
                                  setDelErr('');
                                }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="usr-locked">
                            {isSelf ? 'Your account' : 'Protected role'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="usr-table-foot">
          <span>
            {isDev
              ? 'Developer has full, unrestricted access to manage all accounts and roles across the entire app.'
              : `Strict role hierarchy: as ${me.role}, you can only create, edit, reset passwords for, or delete accounts strictly lower than your role.`}
          </span>
        </div>
      </section>

      {/* Add User Modal */}
      {showAdd &&
        createPortal(
          <div
            className="ov usr-ov"
            onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}
          >
            <div className="md usr-md">
              <div className="usr-md-hd">
                <div>
                  <h3>Add user</h3>
                  <p className="sub">Create a new employee account with direct User ID sign-in.</p>
                </div>
                <button
                  type="button"
                  className="usr-md-close"
                  aria-label="Close modal"
                  onClick={() => setShowAdd(false)}
                >
                  ×
                </button>
              </div>

              <div className="usr-mgrid">
                <div className="usr-mf">
                  <label htmlFor="add-uid">User ID</label>
                  <input
                    id="add-uid"
                    placeholder="letters, numbers, dot"
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                  />
                </div>
                <div className="usr-mf">
                  <label htmlFor="add-name">Full name</label>
                  <input
                    id="add-name"
                    placeholder="Employee full name"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                  />
                </div>
                <div className="usr-mf usr-mf-full">
                  <label htmlFor="add-pw">Temporary password</label>
                  <div className="usr-pw-row">
                    <input
                      id="add-pw"
                      value={addPw}
                      onChange={(e) => setAddPw(e.target.value)}
                    />
                    <button
                      type="button"
                      className="usr-btn usr-btn-secondary"
                      onClick={() => setAddPw(randomTempPassword())}
                    >
                      Generate
                    </button>
                  </div>
                </div>
                <div className="usr-mf">
                  <label htmlFor="add-role">Role</label>
                  <select
                    id="add-role"
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                  >
                    {assignableRoleNames.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="usr-mf">
                  <label htmlFor="add-branch">Branch</label>
                  <select
                    id="add-branch"
                    value={addBranch}
                    onChange={(e) => setAddBranch(e.target.value)}
                  >
                    {['All', ...branches].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="usr-mf usr-mf-full">
                  <label htmlFor="add-loc">Location</label>
                  <select
                    id="add-loc"
                    value={addLoc}
                    onChange={(e) => setAddLoc(e.target.value)}
                  >
                    {['All', ...locations].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {addErr && <div className="er">{addErr}</div>}

              <div className="usr-md-foot">
                <button
                  className="usr-btn usr-btn-secondary"
                  type="button"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
                <button
                  className="usr-btn usr-btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={handleAdd}
                >
                  {busy ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Edit User Modal */}
      {editTarget &&
        createPortal(
          <div
            className="ov usr-ov"
            onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}
          >
            <div className="md usr-md">
              <div className="usr-md-hd">
                <div>
                  <h3>Edit @{editTarget.empId}</h3>
                  <p className="sub">Update display name, role assignment, branch, or location.</p>
                </div>
                <button
                  type="button"
                  className="usr-md-close"
                  aria-label="Close modal"
                  onClick={() => setEditTarget(null)}
                >
                  ×
                </button>
              </div>

              <div className="usr-mgrid">
                <div className="usr-mf usr-mf-full">
                  <label htmlFor="edit-name">Full name</label>
                  <input
                    id="edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="usr-mf">
                  <label htmlFor="edit-role">Role</label>
                  <select
                    id="edit-role"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                  >
                    {assignableRoleNames.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="usr-mf">
                  <label htmlFor="edit-branch">Branch</label>
                  <select
                    id="edit-branch"
                    value={editBranch}
                    onChange={(e) => setEditBranch(e.target.value)}
                  >
                    {['All', ...branches].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="usr-mf usr-mf-full">
                  <label htmlFor="edit-loc">Location</label>
                  <select
                    id="edit-loc"
                    value={editLoc}
                    onChange={(e) => setEditLoc(e.target.value)}
                  >
                    {['All', ...locations].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editErr && <div className="er">{editErr}</div>}

              <div className="usr-md-foot">
                <button
                  className="usr-btn usr-btn-secondary"
                  type="button"
                  onClick={() => setEditTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="usr-btn usr-btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={handleEdit}
                >
                  {busy ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Reset / Activate Password Modal */}
      {pwTarget &&
        createPortal(
          <div
            className="ov usr-ov"
            onClick={(e) => e.target === e.currentTarget && setPwTarget(null)}
          >
            <div className="md usr-md">
              <div className="usr-md-hd">
                <div>
                  <h3>
                    {!isDirectLoginActive(pwTarget) && pwTarget.empId !== 'developer'
                      ? `Activate login for @${pwTarget.empId}`
                      : `Reset password for @${pwTarget.empId}`}
                  </h3>
                  <p className="sub">
                    {!isDirectLoginActive(pwTarget) && pwTarget.empId !== 'developer'
                      ? 'Registers this account for direct User ID + Password sign-in.'
                      : 'Share the new password with the user. They can change it in My profile.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="usr-md-close"
                  aria-label="Close modal"
                  onClick={() => setPwTarget(null)}
                >
                  ×
                </button>
              </div>

              <div className="usr-mf">
                <label htmlFor="reset-pw-in">
                  {!isDirectLoginActive(pwTarget) && pwTarget.empId !== 'developer'
                    ? 'Password (you can reuse their existing password)'
                    : 'New password'}
                </label>
                <div className="usr-pw-row">
                  <input
                    id="reset-pw-in"
                    placeholder="Type password (min 6 characters)"
                    value={resetPwVal}
                    onChange={(e) => setResetPwVal(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    className="usr-btn usr-btn-secondary"
                    type="button"
                    onClick={() => setResetPwVal(randomTempPassword())}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {pwErr && <div className="er">{pwErr}</div>}

              <div className="usr-md-foot">
                <button
                  className="usr-btn usr-btn-secondary"
                  type="button"
                  onClick={() => setPwTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="usr-btn usr-btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={handleResetPw}
                >
                  {busy
                    ? 'Saving...'
                    : !isDirectLoginActive(pwTarget) && pwTarget.empId !== 'developer'
                      ? 'Activate login'
                      : 'Reset password'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Delete User Modal */}
      {delTarget &&
        createPortal(
          <div
            className="ov usr-ov"
            onClick={(e) => e.target === e.currentTarget && setDelTarget(null)}
          >
            <div className="md usr-md">
              <div className="usr-md-hd">
                <div>
                  <h3>Delete user</h3>
                  <p className="sub">This disables sign-in access for @{delTarget.empId}.</p>
                </div>
                <button
                  type="button"
                  className="usr-md-close"
                  aria-label="Close modal"
                  onClick={() => setDelTarget(null)}
                >
                  ×
                </button>
              </div>

              <p className="usr-del-copy">
                Delete <b>{delTarget.name}</b> (@{delTarget.empId})? They will no longer be able to
                sign in.
                {delOpenTasks > 0 && (
                  <>
                    {' '}
                    <b className="usr-del-warn">
                      {delOpenTasks} open task{delOpenTasks === 1 ? ' is' : 's are'} waiting on this
                      user.
                    </b>
                  </>
                )}{' '}
                Past scores stay in the history.
              </p>

              {delErr && <div className="er">{delErr}</div>}

              <div className="usr-md-foot">
                <button
                  className="usr-btn usr-btn-secondary"
                  type="button"
                  onClick={() => setDelTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="usr-btn usr-btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={handleDelete}
                >
                  {busy ? 'Deleting...' : 'Delete user'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
