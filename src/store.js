import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const DEMO_PASSWORD = "Password123!";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const topics = [
  "React Fundamentals", "TypeScript for React", "React Router in Practice", "State Management",
  "TanStack Query Essentials", "Forms with React Hook Form", "Testing React Apps", "Performance Optimization",
  "Accessible UI Design", "Node.js for Frontend Developers", "Design Systems", "Advanced Hooks",
];
const levels = ["Beginner", "Intermediate", "Advanced"];
const statuses = ["published", "published", "draft", "published", "archived", "published", "draft"];
const owners = ["u2", "u3", "u2", "u3", "u1"];

function seedCourses() {
  const courses = [];
  let id = 1;
  for (const level of levels) {
    for (const topic of topics) {
      const day = String(((id * 3) % 27) + 1).padStart(2, "0");
      const month = String(((id * 5) % 11) + 1).padStart(2, "0");
      const endMonth = String(Number(month) + 1).padStart(2, "0");
      courses.push({
        id: String(id),
        title: level === "Beginner" ? topic : `${topic} (${level})`,
        description: `${level} level course covering ${topic.toLowerCase()}.`,
        instructorId: owners[id % owners.length],
        status: statuses[id % statuses.length],
        price: (id % 8) * 10 + 9,
        startDate: `2026-${month}-${day}`,
        endDate: `2026-${endMonth}-${day}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
      });
      id += 1;
    }
  }
  return courses;
}

function seedUsers() {
  const passwordHash = hashPassword(DEMO_PASSWORD);
  return [
    { id: "u1", email: "admin@demo.com", name: "Alice Admin", role: "admin", bio: "Platform administrator.", passwordHash },
    { id: "u2", email: "teacher1@demo.com", name: "Tom Teacher", role: "instructor", bio: "Frontend instructor with 10 years of experience.", passwordHash },
    { id: "u3", email: "teacher2@demo.com", name: "Tina Teacher", role: "instructor", bio: "Full-stack instructor and author.", passwordHash },
    { id: "u4", email: "student@demo.com", name: "Sam Student", role: "student", bio: "Learning React.", passwordHash },
  ];
}

export const db = { users: [], courses: [], nextCourseId: 1 };

export function resetDb() {
  db.users = seedUsers();
  db.courses = seedCourses();
  db.nextCourseId = db.courses.length + 1;
}

resetDb();

export const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name, role: user.role });
