// src/data/rolePermissions.js

/**
 * What each role may do, by default.
 *
 * `hasPermission()` used to read `user.permissions` only — an array nothing ever
 * wrote — so every non-admin was refused on installations, materials, purchases
 * and BOM. The full admin bypass hid it: the office works, the field does not.
 *
 * A grant stored on the user still wins: an explicit list is a deliberate
 * override, and this map is only the floor a role starts with.
 */
export const ROLE_PERMISSIONS = {
  admin: ['*'],

  /** Office oversight: everything an admin does except user administration. */
  manager: [
    'view_customer', 'create_customer', 'edit_customer', 'delete_customer',
    'view_installation', 'create_installation', 'edit_installation', 'delete_installation',
    'assign_material',
    'view_material', 'create_material', 'edit_material', 'delete_material', 'reverse_material',
    'view_purchase', 'create_purchase', 'edit_purchase', 'delete_purchase',
    'generate_pdf',
  ],

  /** The sales agent: their customers, their applications, and read-only jobs. */
  agent: [
    'view_customer', 'create_customer', 'edit_customer',
    'view_installation',
    'generate_pdf',
  ],

  /**
   * The crew that goes to the roof. They read the job they are on and write the
   * evidence — panel serials, photos, inverter — and nothing about money, stock
   * or paperwork.
   */
  installation_team: ['view_installation', 'edit_installation', 'generate_pdf'],
};

/** The permissions a role starts with; an empty list means "nothing by default". */
export const permissionsForRole = (role) => {
  const granted = ROLE_PERMISSIONS[role];
  if (!granted || granted.length === 0) return [];
  return granted;
};

/**
 * Somebody who works from the installation van.
 *
 * The department field came first: accounts were created as `role: 'agent'` and
 * then put in the installation department. The dedicated `installation_team` role
 * was added later, so both spellings exist in the database and mean the same job.
 * Every check goes through here instead of comparing `role` on its own — that
 * comparison is why an existing installer kept landing on the sales dashboard.
 */
export const isInstallationCrew = (user) =>
  Boolean(user) &&
  (user.role === 'installation_team' ||
    (user.role === 'agent' && user.department === 'installation'));

/**
 * The permissions a particular user starts with.
 *
 * An explicit grant on the account still wins. Otherwise the role's floor applies,
 * and somebody in the installation department also gets the crew's floor on top:
 * the legacy `agent` role alone cannot record panel serials or photographs, which
 * is the only thing that account is for.
 */
export const permissionsForUser = (user) => {
  if (!user) return [];

  if (user.permissions?.length) return user.permissions;

  const base = permissionsForRole(user.role);
  if (isInstallationCrew(user) && user.role !== 'installation_team') {
    return [...new Set([...base, ...permissionsForRole('installation_team')])];
  }

  return base;
};

/** One check used by the middleware, so the wildcard rule lives in one place. */
export const roleAllows = (role, permission) => {
  const granted = permissionsForRole(role);
  return granted.includes('*') || granted.includes(permission);
};
