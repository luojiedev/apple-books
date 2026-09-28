import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHistoryError, historyStatus } from "../src/history-status.ts";

test("permission failures explain the separate history permission and full restart", () => {
  for (const code of ["EPERM", "EACCES"]) {
    const error = Object.assign(new Error("private path"), { code });
    const status = historyStatus(describeHistoryError(error));
    assert.match(status, /完全磁盘访问权限/);
    assert.match(status, /Obsidian/);
    assert.match(status, /⌘Q/);
    assert.doesNotMatch(status, /private path/);
  }
});

test("missing history and parser errors retain distinct recovery information", () => {
  assert.match(describeHistoryError(Object.assign(new Error("missing"), { code: "ENOENT" })), /未找到阅读历史数据库/);
  assert.equal(describeHistoryError(new Error("WAL 校验失败")), "WAL 校验失败");
  assert.match(historyStatus(), /检测连接/);
});
