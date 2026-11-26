import React, { useMemo, useState } from 'react';
import {
  BUILTIN_ROLES,
  canManageTargetRole,
  DirectoryEntry,
  getRoleRank,
  isDeveloperRole,
  PERMISSIONS,
  RoleDefinition,
} from '../types';

interface RolesViewProps {
  me: DirectoryEntry;
  canManageRoles: boolean;
  myRolePermissions: number[];
  roles: RoleDefinition[];
  branches: string[];
  locations: string[];
  onCreateRole: (params: {
    name: string;
    branchScope: string;
    locationScope: string;
    permissions: number[];
  }) => Promise<void>;
  onUpdateRole: (params: {
    role: RoleDefinition;
    newName: string;
    branchScope: string;
    locationScope: string;
    permissions: number[];
    summary: string;
  }) => Promise<void>;
  onToast: (m: string) => void;
}

const scopeText = (sb: string, sl: string) =>
  `${sb === 'All' ? 'All branches' : sb} / ${sl === 'All' ? 'all locations' : sl}`;

export const RolesView: React.FC<RolesViewProps> = ({
  me,
  canManageRoles,
  myRolePermissions,
  roles,
  branches,
  locations,
  onCreateRole,
  onUpdateRole,
  onToast,
}) => {
  const [roleName, setRoleName] = useState('');
  const [branchScope, setBranchScope] = useState('All');
  const [locScope, setLocScope] = useState('All');
  const [checkedPerms, setCheckedPerms] = useState<number[]>([]);
  const [createErr, setCreateErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Edit modal
  const [editing, setEditing] = useState<RoleDefinition | null>(null);
  const [editName, setEditName] = useState('');
  const [editSb, setEditSb] = useState('All');
  const [editSl, setEditSl] = useState('All');
  const [editPerms, setEditPerms] = useState<number[]>([]);
  const [editErr, setEditErr] = useState('');

  const isDev = isDeveloperRole(me.role);
  const canCreateCustom = canManageRoles && (isDev || getRoleRank(me.role) > 20);

  const canGrantPermission = (permIdx: number) =>
    isDev || (permIdx !== 6 && myRolePermissions.includes(permIdx));

  const togglePerm = (list: number[], idx: number) => {
    if (!canGrantPermission(idx)) return list;
    return list.includes(idx) ? list.filter((x) => x !== idx) : [...list, idx].sort((a, b) => a - b);
  };

  const handleCreate = async () => {
    setCreateErr('');
    const clean = roleName.trim();
    if (!clean) return;
    if (roles.some((r) => r.name.toLowerCase() === clean.toLowerCase())) {
      setCreateErr('A role with that name already exists.');
      return;
    }
    if (!canManageTargetRole(me.role, clean)) {
      setCreateErr('You can only create roles strictly lower than your own role.');
      return;
    }
    setBusy(true);
    try {
      await onCreateRole({
        name: clean,
        branchScope,
        locationScope: locScope,
        permissions: checkedPerms.filter(canGrantPermission),
      });
      setRoleName('');
      setCheckedPerms([]);
      onToast(`Role "${clean}" created`);
    } catch (err: unknown) {
      setCreateErr(err instanceof Error ? err.message : 'Unable to create role.');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (r: RoleDefinition) => {
    if (!canManageRoles || !canManageTargetRole(me.role, r.name)) return;
    setEditing(r);
    setEditName(r.name);
    setEditSb(r.branchScope);
    setEditSl(r.locationScope);
    setEditPerms([...r.permissions]);
    setEditErr('');
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!canManageTargetRole(me.role, editing.name)) {
      return setEditErr('You cannot edit your own role or any upper role.');
    }
    const isLocked = (BUILTIN_ROLES as readonly string[]).includes(editing.name);
    const nextName = isLocked ? editing.name : editName.trim();
    if (!nextName) return setEditErr('Role name is required.');
    if (!canManageTargetRole(me.role, nextName)) {
      return setEditErr('Role name conflicts with your role or an upper role.');
    }
    if (
      !isLocked &&
      roles.some((x) => x.roleId !== editing.roleId && x.name.toLowerCase() === nextName.toLowerCase())
    ) {
      return setEditErr('A role with that name already exists.');
    }

    const sanitizedPerms = isDev ? editPerms : editPerms.filter(canGrantPermission);

    const changes: string[] = [];
    if (nextName !== editing.name) changes.push(`renamed from "${editing.name}"`);
    if (editSb !== editing.branchScope || editSl !== editing.locationScope) {
      changes.push(
        `scope ${scopeText(editing.branchScope, editing.locationScope)} to ${scopeText(editSb, editSl)}`
      );
    }
    const added = sanitizedPerms
      .filter((k) => !editing.permissions.includes(k))
      .map((k) => PERMISSIONS[k]);
    const removed = editing.permissions
      .filter((k) => !sanitizedPerms.includes(k))
      .map((k) => PERMISSIONS[k]);
    if (added.length) changes.push(`added ${added.join(', ')}`);
    if (removed.length) changes.push(`removed ${removed.join(', ')}`);

    if (!changes.length) {
      setEditing(null);
      onToast('No changes');
      return;
    }

    setBusy(true);
    setEditErr('');
    try {
      await onUpdateRole({
        role: editing,
        newName: nextName,
        branchScope: editSb,
        locationScope: editSl,
        permissions: sanitizedPerms,
        summary: changes.join('; '),
      });
      setEditing(null);
      onToast('Role updated');
    } catch (err: unknown) {
      setEditErr(err instanceof Error ? err.message : 'Unable to update role.');
    } finally {
      setBusy(false);
    }
  };

  const visibleRoles = useMemo(
    () =>
      roles
        .filter((r) => r.name !== 'Developer')
        .sort((a, b) => getRoleRank(b.name) - getRoleRank(a.name)),
    [roles]
  );

  return (
    <div className="view on" id="v-roles">
      <div className="glass sec" style={{ marginTop: 0 }}>
        <h3>Roles and access</h3>
        <div className="tbl">
          <table id="rt">
            <thead>
              <tr>
                <th>Role</th>
                <th>Scope</th>
                {PERMISSIONS.map((p) => (
                  <th key={p}>{p}</th>
                ))}
                {canManageRoles && <th />}
              </tr>
            </thead>
            <tbody>
              {visibleRoles.map((r) => {
                const canEditThisRole = canManageRoles && canManageTargetRole(me.role, r.name);
                return (
                  <tr key={r.roleId}>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td>{scopeText(r.branchScope, r.locationScope)}</td>
                    {PERMISSIONS.map((_, idx) => (
                      <td key={idx} className="ok">
                        {r.permissions.includes(idx) ? '✓' : ''}
                      </td>
                    ))}
                    {canManageRoles && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canEditThisRole ? (
                          <button className="btn g" type="button" onClick={() => openEdit(r)}>
                            Edit
                          </button>
                        ) : (
                          <span className="sub">
                            {r.name === me.role ? 'Your role' : 'Protected'}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10 }}>
          Developer is not listed because it always has full, unrestricted access to every
          screen and action. Non-Developer users can only modify roles strictly lower than
          their own.
        </div>
      </div>

      {canCreateCustom && (
        <div className="glass sec" id="rf">
          <h3>Create a custom role</h3>
          <div className="row">
            <div>
              <label htmlFor="rn">Role name</label>
              <input
                id="rn"
                placeholder="e.g. Plant Supervisor"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="rsb">Branch scope</label>
              <select
                id="rsb"
                value={branchScope}
                onChange={(e) => setBranchScope(e.target.value)}
              >
                <option value="All">All</option>
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rsl">Location scope</label>
              <select
                id="rsl"
                value={locScope}
                onChange={(e) => setLocScope(e.target.value)}
              >
                <option value="All">All</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label>Permissions</label>
          <div className="pc" id="pc">
            {PERMISSIONS.map((p, i) => {
              const allowed = canGrantPermission(i);
              return (
                <label key={p} style={!allowed ? { opacity: 0.5 } : undefined}>
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={checkedPerms.includes(i)}
                    onChange={() => setCheckedPerms((cur) => togglePerm(cur, i))}
                  />
                  {p}
                </label>
              );
            })}
          </div>

          {createErr && <div className="er">{createErr}</div>}

          <div style={{ marginTop: 14 }}>
            <button
              className="btn"
              id="rcb"
              type="button"
              disabled={busy}
              onClick={handleCreate}
            >
              Create role
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="ov"
          onClick={(e) => e.target === e.currentTarget && setEditing(null)}
        >
          <div className="md">
            <h3>Edit role</h3>
            <label>Role name</label>
            <input
              value={editName}
              disabled={(BUILTIN_ROLES as readonly string[]).includes(editing.name)}
              onChange={(e) => setEditName(e.target.value)}
            />
            {(BUILTIN_ROLES as readonly string[]).includes(editing.name) && (
              <div className="sub" style={{ marginTop: 6 }}>
                Built-in role names are fixed because the app&apos;s access rules depend on
                them. Scope and permissions can be changed.
              </div>
            )}

            <label>Branch scope</label>
            <select value={editSb} onChange={(e) => setEditSb(e.target.value)}>
              {Array.from(new Set(['All', ...branches, editing.branchScope])).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <label>Location scope</label>
            <select value={editSl} onChange={(e) => setEditSl(e.target.value)}>
              {Array.from(new Set(['All', ...locations, editing.locationScope])).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>

            <label>Permissions</label>
            <div className="pc">
              {PERMISSIONS.map((p, idx) => {
                const allowed = canGrantPermission(idx);
                return (
                  <label key={p} style={!allowed ? { opacity: 0.5 } : undefined}>
                    <input
                      type="checkbox"
                      disabled={!allowed}
                      checked={editPerms.includes(idx)}
                      onChange={() => setEditPerms((cur) => togglePerm(cur, idx))}
                    />
                    {p}
                  </label>
                );
              })}
            </div>

            {editErr && <div className="er">{editErr}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn g" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={busy} onClick={handleSaveEdit}>
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

