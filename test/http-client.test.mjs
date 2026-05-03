import test from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "../src/http-client.mjs";

test("CookieJar emits matching unexpired cookies", () => {
  const jar = new CookieJar([
    {
      name: "session",
      value: "abc",
      domain: "www.gradescope.com",
      path: "/",
      secure: true,
    },
    {
      name: "course",
      value: "123",
      domain: "www.gradescope.com",
      path: "/courses",
      secure: true,
    },
  ]);

  assert.equal(
    jar.cookieHeader("https://www.gradescope.com/courses/123"),
    "session=abc; course=123",
  );
  assert.equal(jar.cookieHeader("http://www.gradescope.com/courses/123"), "");
});

test("CookieJar parses Set-Cookie headers into storage-state shape", () => {
  const jar = new CookieJar();
  jar.setCookieHeader("_gradescope_session=xyz; Path=/; HttpOnly; Secure; SameSite=Lax", "https://www.gradescope.com/login");

  const state = jar.toStorageState();
  assert.equal(state.cookies.length, 1);
  assert.equal(state.cookies[0].name, "_gradescope_session");
  assert.equal(state.cookies[0].value, "xyz");
  assert.equal(state.cookies[0].domain, "www.gradescope.com");
  assert.equal(state.cookies[0].path, "/");
  assert.equal(state.cookies[0].httpOnly, true);
  assert.equal(state.cookies[0].secure, true);
});
