import assert from "node:assert/strict";
import test from "node:test";
import { selectAuthScreen } from "../src/features/auth/routing";

test("the explicit user login URL shows the phone form even with an administrator session", () => {
  assert.equal(selectAuthScreen("/login", true, "admin"), "userLogin");
  assert.equal(selectAuthScreen("/login/", true, "admin"), "userLogin");
  assert.equal(selectAuthScreen("/login", true, "user"), "userLogin");
});

test("the phone login form is available before authentication or SMS is configured", () => {
  assert.equal(selectAuthScreen("/login", false), "userLogin");
  assert.equal(selectAuthScreen("/", true), "userLogin");
});

test("an administrator session cannot open the personal workspace as a user", () => {
  assert.equal(selectAuthScreen("/", true, "admin"), "userLogin");
  assert.equal(selectAuthScreen("/", true, "user"), "studio");
});

test("administrator routing preserves the existing role and authentication checks", () => {
  assert.equal(selectAuthScreen("/admin", true, "admin"), "admin");
  assert.equal(selectAuthScreen("/admin/", true), "adminLogin");
  assert.equal(selectAuthScreen("/admin", true, "user"), "adminLogin");
  assert.equal(selectAuthScreen("/admin", false), "adminDisabled");
  assert.equal(selectAuthScreen("/", false), "studio");
});
