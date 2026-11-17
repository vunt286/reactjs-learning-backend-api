// Server-side source of truth for authorization. The client mirrors it only for UX.
export const ROLES = ["admin", "instructor", "student"];

export const rolePermissions = {
  admin: ["course:create", "course:update", "course:delete", "course:publish", "user:manage"],
  instructor: ["course:create", "course:update", "course:delete", "course:publish"],
  student: [],
};

export function permissionsFor(user) {
  return rolePermissions[user.role] ?? [];
}

const isOwner = (user, course) => course.instructorId === user.id;

export function can(user, permission, course) {
  if (!permissionsFor(user).includes(permission)) return false;
  if (!course || user.role === "admin") return true;
  if (!permission.startsWith("course:") || permission === "course:create") return true;
  if (!isOwner(user, course)) return false;
  if (permission === "course:delete") return course.status !== "published";
  return true;
}

// Admins see everything, everyone sees published courses, owners see their own drafts/archived.
export function canView(user, course) {
  return user.role === "admin" || course.status === "published" || isOwner(user, course);
}
