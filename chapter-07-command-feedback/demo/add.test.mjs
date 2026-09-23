import assert from "node:assert/strict";
import test from "node:test";
import { add } from "./add.mjs";

test("add(2, 3) 应该等于 5", () => {
  assert.equal(add(2, 3), 5);
});
