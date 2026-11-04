import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ResultSchema } from "@modelcontextprotocol/core";

const extension = "io.modelcontextprotocol/skills";
const client = new Client(
  { name: "skills-reader", version: "1.0.0" },
  {
    // クライアントが Skills Extension を扱うことを宣言する。
    capabilities: { extensions: { [extension]: {} } },
    // サンプルで使う MCP のプロトコルバージョンを指定する。
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  },
);
// 同じディレクトリの server.mjs を Node.js で起動するための設定。
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
});

try {
  // サーバーを起動し、標準入出力を使って接続する。
  await client.connect(transport);
  // スキルのメタデータ一覧を取得する。本文はまだ取得しない。
  const { skills } = await client.request(
    { method: "skills/list", params: {} },
    ResultSchema,
  );
  // frontmatter の name を使って、今回読みたいスキルを選ぶ。
  const skill = skills.find(
    (entry) => entry.frontmatter.name === "code-review",
  );
  if (!skill) throw new Error("code-review skill was not found");
  console.log(`Discovered: ${skill.uri}`);

  // 一覧で得た URI を指定して、SKILL.md の本文を取得する。
  const { contents } = await client.readResource({ uri: skill.uri });
  // 応答に含まれるテキストを表示する。
  for (const content of contents) {
    if ("text" in content) console.log(content.text);
  }
} finally {
  // エラーが起きた場合も接続を閉じ、子プロセスを終了する。
  await client.close();
}
