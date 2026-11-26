import React, { useMemo, useState } from 'react';
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

export const UsersView: React.FC<UsersViewProps> = ({
  me,
  directory,
  roles,
  branches,
  locations,
  tasks,
  onCreateUser,
  onUpdateUser,
  onResetPassword,
  onDeleteUser,
}) => {
  const [queryText, setQueryText] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
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

  // Roles this signed-in user is strictly permitted to assign
  const assignableRoleNames = useMemo(
    () => allRoleNames.filter((r) => canManageTargetRole(me.role, r)),
    [allRoleNames, me.role]
  );

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return directory.filter(
      (u) =>
        (!q || u.empId.includes(q) || u.name.toLowerCase().includes(q)) &&
        (roleFilter === 'All' || u.role === roleFilter)
    );
  }, [directory, queryText, roleFilter]);

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
      <div className="glass sec" style={{ marginTop: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <h3 style={{ margin: 0 }}>User management</h3>
          {assignableRoleNames.length > 0 && (
            <button className="btn" id="uadd" type="button" onClick={openAdd}>
              Add user
            </button>
          )}
        </div>

        <div className="row" style={{ margin: '14px 0' }}>
          <div>
            <label htmlFor="uq">Search</label>
            <input
              id="uq"
              placeholder="Name or user ID"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ur">Role</label>
            <select
              id="ur"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="All">All</option>
              {allRoleNames.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="tbl">
          <table id="ut">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const manageable = canManageUser(me, u);
                const isSelf = u.empId === me.empId;
                return (
                  <tr key={u.docId}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span
                          className={`av${u.photoUrl ? ' ph' : ''}`}
                          style={{
                            width: 34,
                            height: 34,
                            flex: 'none',
                            fontSize: 14,
                            backgroundImage: u.photoUrl ? `url("${u.photoUrl}")` : undefined,
                          }}
                        >
                          {u.name[0]}
                        </span>
                        <div>
                          <b>{u.name}</b>
                          <div className="sub">@{u.empId}</div>
                        </div>
                      </div>
                    </td>
                    <td>{u.role}</td>
                    <td>{u.branch || '-'}</td>
                    <td>{u.location}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {manageable ? (
                        <>
                          <button className="btn g" type="button" onClick={() => openEdit(u)}>
                            Edit
                          </button>{' '}
                          <button
                            className="btn g"
                            type="button"
                            onClick={() => {
                              setPwTarget(u);
                              setResetPwVal(randomTempPassword());
                              setPwErr('');
                            }}
                          >
                            Reset password
                          </button>
                          {!isSelf && (
                            <>
                              {' '}
                              <button
                                className="btn r"
                                type="button"
                                onClick={() => {
                                  setDelTarget(u);
                                  setDelErr('');
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="sub">
                          {isSelf ? 'Your account' : 'Protected role'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="sub" style={{ marginTop: 10 }}>
          {isDev
            ? 'Developer has full, unrestricted access to manage all accounts and roles across the entire app.'
            : `Strict role hierarchy: as ${me.role}, you can only create, edit, reset passwords for, or delete accounts strictly lower than your role. Your own account and same/upper roles cannot be modified.`}
        </div>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="ov" onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="md">
            <h3>Add user</h3>
            <label>User ID</label>
            <input
              placeholder="letters, numbers, dot"
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
            />
            <label>Full name</label>
            <input value={addName} onChange={(e) => setAddName(e.target.value)} />
            <label>Temporary password</label>
            <input value={addPw} onChange={(e) => setAddPw(e.target.value)} />
            <label>Role</label>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              {assignableRoleNames.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label>Branch</label>
            <select value={addBranch} onChange={(e) => setAddBranch(e.target.value)}>
              {['All', ...branches].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <label>Location</label>
            <select value={addLoc} onChange={(e) => setAddLoc(e.target.value)}>
              {['All', ...locations].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            {addErr && <div className="er">{addErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn g" type="button" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={busy} onClick={handleAdd}>
                Create user
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editTarget && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}
        >
          <div className="md">
            <h3>Edit @{editTarget.empId}</h3>
            <label>Full name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            <label>Role</label>
            <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
              {assignableRoleNames.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label>Branch</label>
            <select value={editBranch} onChange={(e) => setEditBranch(e.target.value)}>
              {['All', ...branches].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <label>Location</label>
            <select value={editLoc} onChange={(e) => setEditLoc(e.target.value)}>
              {['All', ...locations].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            {editErr && <div className="er">{editErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn g" type="button" onClick={() => setEditTarget(null)}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={busy} onClick={handleEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {pwTarget && (
        <div className="ov" onClick={(e) => e.target === e.currentTarget && setPwTarget(null)}>
          <div className="md">
            <h3>Reset password for @{pwTarget.empId}</h3>
            <label>New password</label>
            <input value={resetPwVal} onChange={(e) => setResetPwVal(e.target.value)} />
            <div className="sub" style={{ marginTop: 8 }}>
              Share this with the user. They can change it from My profile.
            </div>
            {pwErr && <div className="er">{pwErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn g" type="button" onClick={() => setPwTarget(null)}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={busy} onClick={handleResetPw}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {delTarget && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setDelTarget(null)}
        >
          <div className="md">
            <h3>Delete user</h3>
            <p>
              Delete <b>{delTarget.name}</b> (@{delTarget.empId})? They will no longer be able
              to sign in.
              {delOpenTasks > 0 && (
                <>
                  {' '}
                  <b style={{ color: 'var(--red)' }}>
                    {delOpenTasks} open task(s) are waiting on this user.
                  </b>
                </>
              )}{' '}
              Past scores stay in the history.
            </p>
            {delErr && <div className="er">{delErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn g" type="button" onClick={() => setDelTarget(null)}>
                Cancel
              </button>
              <button className="btn r" type="button" disabled={busy} onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

