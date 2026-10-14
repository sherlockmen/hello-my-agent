# add.test.mjs

`chapter-12-task-control/demo-project/test/add.test.mjs`

<a href="./content/chapter-12-task-control/demo-project/test/add.test.mjs" download>下载原始文件</a>

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/add.mjs";

test("adds two numbers", () => {
  assert.equal(add(2, 3), 5);
});
```
