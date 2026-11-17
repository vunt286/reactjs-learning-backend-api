import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

process.env.ENABLE_DEBUG_ROUTES = "true";
process.env.ACCESS_TOKEN_TTL_SECONDS = "60";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { createApp } = await import("../src/app.js");

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

class Client {
  jar = new Map();
  async request(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [k, ...v] = pair.split("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(k);
      else this.jar.set(k, v.join("="));
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get = (p) => this.request("GET", p);
  post = (p, b) => this.request("POST", p, b ?? undefined);
  patch = (p, b) => this.request("PATCH", p, b);
  del = (p) => this.request("DELETE", p);
}

async function login(email) {
  const c = new Client();
  const res = await c.post("/auth/login", { email, password: "Password123!" });
  assert.equal(res.status, 200);
  return c;
}

const validCourse = {
  title: "Brand New Course", price: 20, startDate: "2026-05-01", endDate: "2026-06-01", description: "x",
};

beforeEach(async () => {
  await new Client().post("/debug/reset");
});

describe("auth", () => {
  it("rejects bad credentials with a generic message", async () => {
    const c = new Client();
    const a = await c.post("/auth/login", { email: "nobody@demo.com", password: "Password123!" });
    const b = await c.post("/auth/login", { email: "admin@demo.com", password: "wrong" });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  it("logs in, restores session via /me, and logs out", async () => {
    const c = await login("teacher1@demo.com");
    assert.ok(c.jar.has("access_token") && c.jar.has("refresh_token"));
    const me = await c.get("/me");
    assert.equal(me.body.user.role, "instructor");
    assert.ok(me.body.user.permissions.includes("course:create"));
    assert.equal((await c.post("/auth/logout")).status, 204);
    assert.equal((await c.get("/me")).status, 401);
  });

  it("returns 401 without a session", async () => {
    assert.equal((await new Client().get("/courses")).status, 401);
  });

  it("flags expired access tokens and refreshes with rotation", async () => {
    const c = await login("student@demo.com");
    const oldRefresh = c.jar.get("refresh_token");
    await c.post("/debug/expire-access");
    const expired = await c.get("/me");
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "SESSION_EXPIRED");

    const refreshed = await c.post("/auth/refresh");
    assert.equal(refreshed.status, 200);
    assert.notEqual(c.jar.get("refresh_token"), oldRefresh);
    assert.equal((await c.get("/me")).status, 200);

    const replay = new Client();
    replay.jar.set("refresh_token", oldRefresh);
    assert.equal((await replay.post("/auth/refresh")).status, 401);
  });

  it("locks out after repeated failures", async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.post("/auth/login", { email: "admin@demo.com", password: "x" });
    const res = await c.post("/auth/login", { email: "admin@demo.com", password: "Password123!" });
    assert.equal(res.status, 429);
  });
});

describe("cors", () => {
  it("allows configured origins with credentials and rejects others", async () => {
    const ok = await fetch(`${base}/health`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    const bad = await fetch(`${base}/health`, { headers: { Origin: "http://evil.com" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
    const post = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Origin: "http://evil.com" } });
    assert.equal(post.status, 403);
  });
});

describe("courses: listing", () => {
  it("paginates, sorts and filters", async () => {
    const c = await login("admin@demo.com");
    const page1 = (await c.get("/courses?pageSize=5&sort=title&order=asc")).body;
    assert.equal(page1.items.length, 5);
    assert.equal(page1.page, 1);
    assert.ok(page1.totalPages > 1);
    const titles = page1.items.map((i) => i.title);
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));

    const drafts = (await c.get("/courses?status=draft&pageSize=50")).body;
    assert.ok(drafts.items.every((i) => i.status === "draft"));

    const search = (await c.get("/courses?q=router")).body;
    assert.ok(search.items.length > 0 && search.items.every((i) => /router/i.test(i.title + i.description)));

    const beyond = (await c.get("/courses?page=999")).body;
    assert.equal(beyond.items.length, 0);
    assert.ok(beyond.totalPages < 999);
  });

  it("validates query params", async () => {
    const c = await login("admin@demo.com");
    const res = await c.get("/courses?status=hacked&page=0");
    assert.equal(res.status, 422);
    assert.ok(res.body.error.fieldErrors.status && res.body.error.fieldErrors.page);
  });

  it("hides non-published courses of others", async () => {
    const student = await login("student@demo.com");
    const list = (await student.get("/courses?pageSize=50")).body;
    assert.ok(list.items.every((i) => i.status === "published"));
    assert.ok(list.items.every((i) => !i.permissions.canEdit && !i.permissions.canDelete));

    const teacher2 = await login("teacher2@demo.com");
    const draftOfTeacher1 = (await (await login("admin@demo.com")).get("/courses?status=draft&pageSize=50")).body.items
      .find((i) => i.instructorId === "u2");
    assert.equal((await teacher2.get(`/courses/${draftOfTeacher1.id}`)).status, 404);
    assert.equal((await student.get(`/courses/${draftOfTeacher1.id}`)).status, 404);
    assert.equal((await teacher2.get("/courses/abc")).status, 404);
  });
});

describe("courses: mutations and authorization", () => {
  it("students cannot create", async () => {
    const c = await login("student@demo.com");
    assert.equal((await c.post("/courses", validCourse)).status, 403);
  });

  it("instructor creates, validates, and detects duplicate titles", async () => {
    const c = await login("teacher1@demo.com");
    const bad = await c.post("/courses", { ...validCourse, title: "ab", price: -1, endDate: "2026-04-01" });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.fieldErrors.title && bad.body.error.fieldErrors.price && bad.body.error.fieldErrors.endDate);

    const created = await c.post("/courses", validCourse);
    assert.equal(created.status, 201);
    assert.equal(created.body.instructorId, "u2");
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.permissions.canEdit, true);

    const dup = await c.post("/courses", validCourse);
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.fieldErrors.title, "Title already exists");
  });

  it("only owners (or admins) may edit; partial updates keep other fields", async () => {
    const t1 = await login("teacher1@demo.com");
    const t2 = await login("teacher2@demo.com");
    const { body: course } = await t1.post("/courses", validCourse);
    assert.equal((await t2.patch(`/courses/${course.id}`, { price: 1 })).status, 404);

    await t1.post(`/courses/${course.id}/publish`);
    assert.equal((await t2.patch(`/courses/${course.id}`, { price: 1 })).status, 403);

    const patched = await t1.patch(`/courses/${course.id}`, { price: 77 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.price, 77);
    assert.equal(patched.body.status, "published");
    assert.equal(patched.body.description, "x");

    const admin = await login("admin@demo.com");
    assert.equal((await admin.patch(`/courses/${course.id}`, { price: 5 })).status, 200);
  });

  it("published courses cannot be deleted", async () => {
    const t1 = await login("teacher1@demo.com");
    const { body: course } = await t1.post("/courses", validCourse);
    await t1.post(`/courses/${course.id}/publish`);
    const blocked = await t1.del(`/courses/${course.id}`);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "COURSE_PUBLISHED");
    assert.equal((await t1.post(`/courses/${course.id}/unpublish`)).body.status, "draft");
    assert.equal((await t1.del(`/courses/${course.id}`)).status, 204);
    assert.equal((await t1.get(`/courses/${course.id}`)).status, 404);
  });

  it("students cannot publish or delete", async () => {
    const s = await login("student@demo.com");
    const list = (await s.get("/courses")).body.items;
    assert.equal((await s.post(`/courses/${list[0].id}/unpublish`)).status, 403);
    assert.equal((await s.del(`/courses/${list[0].id}`)).status, 403);
  });
});

describe("instructors, admin, debug", () => {
  it("serves instructor details", async () => {
    const c = await login("student@demo.com");
    const res = await c.get("/instructors/u2");
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Tom Teacher");
    assert.equal((await c.get("/instructors/u4")).status, 404);
  });

  it("restricts /admin to admins and applies role changes immediately", async () => {
    const t = await login("teacher1@demo.com");
    assert.equal((await t.get("/admin/users")).status, 403);

    const admin = await login("admin@demo.com");
    assert.equal((await admin.get("/admin/users")).body.length, 4);
    assert.equal((await admin.patch("/admin/users/u2/role", { role: "student" })).status, 200);
    assert.equal((await t.post("/courses", validCourse)).status, 403);
    assert.equal((await t.get("/me")).body.user.role, "student");
    assert.equal((await admin.patch("/admin/users/u1/role", { role: "student" })).status, 409);
  });

  it("simulates errors and unknown routes", async () => {
    const c = await login("admin@demo.com");
    assert.equal((await c.get("/courses?_fail=500")).status, 500);
    const missing = await c.get("/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "NOT_FOUND");
  });
});
