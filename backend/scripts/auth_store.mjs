/**
 * SQLite + scrypt-backed auth store for the Quill gateway.
 *
 * Uses only Node built-ins (node:sqlite, node:crypto) — no native deps.
 * Provides local-account auth: first-run admin setup, register, login, session
 * cookies (opaque tokens in a sessions table), me, logout, change-password.
 *
 * This is opt-in; the launcher enables it only when QUILL_AUTH_ENABLED=1.
 */

import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash: derived };
}
function verifyPassword(password, salt, expectedHash) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      system_role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
  const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const userById = db.prepare("SELECT * FROM users WHERE id = ?");
  const insertUser = db.prepare(
    "INSERT INTO users (id, email, name, salt, password_hash, system_role, created_at) VALUES (?,?,?,?,?,?,?)",
  );
  const updatePw = db.prepare("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?");
  const insertSession = db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
  );
  const sessionByToken = db.prepare("SELECT * FROM sessions WHERE token = ?");
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");

  function publicUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? row.email,
      system_role: row.system_role,
      needs_setup: false,
      oauth_provider: null,
    };
  }
  function newSession(userId) {
    const token = randomBytes(32).toString("hex");
    insertSession.run(token, userId, new Date().toISOString(), Date.now() + SESSION_TTL_MS);
    return token;
  }
  function createUser(email, password, name, role) {
    const { salt, hash } = hashPassword(password);
    const id = randomBytes(12).toString("hex");
    insertUser.run(id, email, name ?? email, salt, hash, role, new Date().toISOString());
    return userById.get(id);
  }

  return {
    setupStatus() {
      return { needs_setup: countUsers.get().n === 0 };
    },
    initialize(email, password, name) {
      if (countUsers.get().n > 0) return { error: "already_initialized" };
      if (!email || !password) return { error: "invalid_input" };
      const row = createUser(email, password, name, "admin");
      return { user: publicUser(row), token: newSession(row.id) };
    },
    register(email, password, name) {
      if (!email || !password) return { error: "invalid_input" };
      if (userByEmail.get(email)) return { error: "email_taken" };
      const role = countUsers.get().n === 0 ? "admin" : "user";
      const row = createUser(email, password, name, role);
      return { user: publicUser(row), token: newSession(row.id) };
    },
    login(email, password) {
      const row = userByEmail.get(email);
      if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
        return { error: "invalid_credentials" };
      }
      return { user: publicUser(row), token: newSession(row.id) };
    },
    me(token) {
      if (!token) return null;
      const s = sessionByToken.get(token);
      if (!s || s.expires_at < Date.now()) {
        if (s) deleteSession.run(token);
        return null;
      }
      return publicUser(userById.get(s.user_id));
    },
    changePassword(token, oldPassword, newPassword) {
      const s = token && sessionByToken.get(token);
      if (!s) return { error: "unauthenticated" };
      const row = userById.get(s.user_id);
      if (!row || !verifyPassword(oldPassword, row.salt, row.password_hash)) {
        return { error: "invalid_credentials" };
      }
      const { salt, hash } = hashPassword(newPassword);
      updatePw.run(salt, hash, row.id);
      return { success: true };
    },
    logout(token) {
      if (token) deleteSession.run(token);
      return { success: true };
    },
  };
}
