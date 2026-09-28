import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHistory } from "../src/reading-history.ts";

import { historyFixture, integer, bytes, message } from "./fixtures/history.ts";

test("CRDT v4 combines the monthly register and daily counters", () => {
  const history = decodeHistory(historyFixture());
  assert.equal(history.seconds, 3720); assert.equal(history.months.get(202601), 3720); assert.deepEqual(history.years, [2026]);
});
test("unsupported, truncated and excessive nesting history is rejected", () => {
  assert.throws(() => decodeHistory(Buffer.from("crdt\x06\0\0\0")), /版本 4/);
  assert.throws(() => decodeHistory(Buffer.from("crdt\x04\0\0\0\xff")), /varint/);
  let nested = integer(1, 1); for (let i = 0; i < 35; i++) nested = bytes(1, nested);
  assert.throws(() => decodeHistory(message(Buffer.from("crdt\x04\0\0\0"), nested)), /嵌套/);
});
