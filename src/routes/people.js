import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { ApiError, forbidden, notFound, parseOrThrow } from "../errors.js";
import { can, ROLES } from "../permissions.js";
import { db, publicUser } from "../store.js";

const instructorOf = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  bio: user.bio,
  courseCount: db.courses.filter((c) => c.instructorId === user.id && c.status === "published").length,
});

export const instructorsRouter = Router();
instructorsRouter.use(authenticate);

const isInstructor = (u) => u.role === "instructor" || u.role === "admin";

instructorsRouter.get("/", (_req, res) => {
  res.json(db.users.filter(isInstructor).map(instructorOf));
});

instructorsRouter.get("/:id", (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id && isInstructor(u));
  if (!user) throw notFound("Instructor not found");
  res.json(instructorOf(user));
});

export const adminRouter = Router();
adminRouter.use(authenticate, (req, _res, next) => {
  if (!can(req.user, "user:manage")) return next(forbidden());
  next();
});

adminRouter.get("/users", (_req, res) => {
  res.json(db.users.map(publicUser));
});

const roleSchema = z.object({ role: z.enum(ROLES, "Invalid role") });

adminRouter.patch("/users/:id/role", (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw notFound("User not found");
  const { role } = parseOrThrow(roleSchema, req.body ?? {});
  if (user.id === req.user.id && role !== "admin") {
    throw new ApiError(409, "CANNOT_DEMOTE_SELF", "You cannot remove your own admin role");
  }
  user.role = role;
  res.json(publicUser(user));
});
