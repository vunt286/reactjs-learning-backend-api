import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { forbidden, notFound, parseOrThrow, validationError } from "../errors.js";
import { can, canView } from "../permissions.js";
import { db } from "../store.js";

export const coursesRouter = Router();
coursesRouter.use(authenticate);

const STATUSES = ["draft", "published", "archived"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

const baseCourse = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(120, "Title is too long"),
  instructorId: z.string().min(1, "Instructor is required").optional(),
  status: z.enum(STATUSES, "Invalid status"),
  price: z.coerce.number("Price must be a number").min(0, "Price cannot be negative"),
  startDate: date,
  endDate: date,
  description: z.string().max(500, "Description is too long"),
});

const endAfterStart = (data, ctx) => {
  if (data.startDate && data.endDate && data.endDate <= data.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
  }
};

const createSchema = baseCourse
  .extend({
    status: baseCourse.shape.status.default("draft"),
    description: baseCourse.shape.description.default(""),
  })
  .superRefine(endAfterStart);
const partialSchema = baseCourse.partial().superRefine(endAfterStart);

const listQuerySchema = z.object({
  q: z.string().trim().default(""),
  status: z.enum(["all", ...STATUSES], "Invalid status").default("all"),
  sort: z.enum(["title", "createdAt", "price"], "Invalid sort field").default("createdAt"),
  order: z.enum(["asc", "desc"], "Invalid order").default("desc"),
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  pageSize: z.coerce.number().int().min(1).max(50, "pageSize cannot exceed 50").default(10),
});

const instructorName = (id) => db.users.find((u) => u.id === id)?.name ?? "Unknown";

function serialize(course, user) {
  return {
    ...course,
    instructorName: instructorName(course.instructorId),
    permissions: {
      canEdit: can(user, "course:update", course),
      canDelete: can(user, "course:delete", course),
      canPublish: can(user, "course:publish", course),
    },
  };
}

// Invalid ids and invisible courses both produce 404, so private resources are not revealed.
function findVisibleCourse(req) {
  const course = /^\d+$/.test(req.params.id) ? db.courses.find((c) => c.id === req.params.id) : undefined;
  if (!course || !canView(req.user, course)) throw notFound("Course not found");
  return course;
}

function assertTitleAvailable(title, ignoreId) {
  const taken = db.courses.some((c) => c.id !== ignoreId && c.title.toLowerCase() === title.toLowerCase());
  if (taken) throw validationError({ title: "Title already exists" });
}

function resolveInstructor(user, requestedId) {
  if (user.role !== "admin") {
    if (requestedId && requestedId !== user.id) {
      throw forbidden("Only admins can assign a course to another instructor");
    }
    return user.id;
  }
  const id = requestedId ?? user.id;
  const instructor = db.users.find((u) => u.id === id && u.role !== "student");
  if (!instructor) throw validationError({ instructorId: "Instructor not found" });
  return id;
}

coursesRouter.get("/", (req, res) => {
  const { q, status, sort, order, page, pageSize } = parseOrThrow(listQuerySchema, req.query);
  const needle = q.toLowerCase();

  let items = db.courses.filter((c) => canView(req.user, c));
  if (status !== "all") items = items.filter((c) => c.status === status);
  if (needle) {
    items = items.filter((c) =>
      [c.title, c.description, instructorName(c.instructorId)].some((v) => v.toLowerCase().includes(needle)),
    );
  }

  const direction = order === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const cmp = sort === "price" ? a.price - b.price
      : sort === "title" ? a.title.localeCompare(b.title)
      : a.createdAt.localeCompare(b.createdAt);
    return (cmp || Number(a.id) - Number(b.id)) * direction;
  });

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  res.json({
    items: items.slice(start, start + pageSize).map((c) => serialize(c, req.user)),
    total,
    page,
    pageSize,
    totalPages,
  });
});

coursesRouter.get("/:id", (req, res) => {
  res.json(serialize(findVisibleCourse(req), req.user));
});

coursesRouter.post("/", (req, res) => {
  if (!can(req.user, "course:create")) throw forbidden("You cannot create courses");
  const data = parseOrThrow(createSchema, req.body ?? {});
  assertTitleAvailable(data.title);
  const instructorId = resolveInstructor(req.user, data.instructorId);
  if (data.status === "published" && !can(req.user, "course:publish")) throw forbidden("You cannot publish courses");

  const now = new Date().toISOString();
  const course = { ...data, instructorId, id: String(db.nextCourseId++), createdAt: now, updatedAt: now };
  db.courses.push(course);
  res.status(201).location(`/courses/${course.id}`).json(serialize(course, req.user));
});

function update(schema) {
  return (req, res) => {
    const course = findVisibleCourse(req);
    if (!can(req.user, "course:update", course)) throw forbidden("You cannot edit this course");

    const data = parseOrThrow(schema, req.body ?? {});
    const merged = { ...course, ...data };
    if (schema === partialSchema) {
      parseOrThrow(createSchema, { ...merged, instructorId: undefined });
    }
    if (data.title) assertTitleAvailable(data.title, course.id);
    if (data.status && data.status !== course.status && !can(req.user, "course:publish", course)) {
      throw forbidden("You cannot change the publication status of this course");
    }
    if (data.instructorId !== undefined && data.instructorId !== course.instructorId) {
      merged.instructorId = resolveInstructor(req.user, data.instructorId);
    }

    Object.assign(course, merged, { updatedAt: new Date().toISOString() });
    res.json(serialize(course, req.user));
  };
}

coursesRouter.put("/:id", update(createSchema));
coursesRouter.patch("/:id", update(partialSchema));

coursesRouter.delete("/:id", (req, res) => {
  const course = findVisibleCourse(req);
  if (!can(req.user, "course:delete", course)) {
    const ownsIt = req.user.role === "admin" || course.instructorId === req.user.id;
    if (ownsIt && course.status === "published") {
      throw forbidden("Published courses cannot be deleted. Unpublish it first.", "COURSE_PUBLISHED");
    }
    throw forbidden("You cannot delete this course");
  }
  db.courses.splice(db.courses.indexOf(course), 1);
  res.status(204).end();
});

function setStatus(status) {
  return (req, res) => {
    const course = findVisibleCourse(req);
    if (!can(req.user, "course:publish", course)) throw forbidden("You cannot change the publication status of this course");
    course.status = status;
    course.updatedAt = new Date().toISOString();
    res.json(serialize(course, req.user));
  };
}

coursesRouter.post("/:id/publish", setStatus("published"));
coursesRouter.post("/:id/unpublish", setStatus("draft"));
