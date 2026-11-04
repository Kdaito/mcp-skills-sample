import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { parse } from "yaml";

// SKILL.md の YAML frontmatter からメタデータを抽出する
function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error("YAML frontmatter is required");
  return parse(match[1]);
}

const extension = "io.modelcontextprotocol/skills";
const root = "skill://code-review";
const uri = `${root}/SKILL.md`;
const paths = ["SKILL.md", "references/checklist.md"];
const files = new Map();
// ローカルのファイルを読み込み、URI に対応付ける
for (const path of paths) {
  const bytes = await readFile(
    new URL(`./skills/code-review/${path}`, import.meta.url),
  );
  files.set(`${root}/${path}`, bytes);
}
// skills/list, skills/get で返すスキルの情報を作る
const skill = {
  uri,
  frontmatter: frontmatter(files.get(uri).toString("utf8")),
  resources: [...files].map(([uri, bytes]) => ({
    uri,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    size: bytes.length,
  })),
};

// キャッシュの有効期間と共有範囲を指定して返すヘルパー関数
// ttlMs: 0 は、応答を使い回さずその都度取得してよいという指定
const cached = (value) => ({
  resultType: "complete",
  ...value,
  ttlMs: 0,
  cacheScope: "public",
});
const invalid = (message) => {
  throw { code: -32602, message };
};

function dispatch(method, params = {}) {
  switch (method) {
    // skills extension に対応していることを宣言する
    case "server/discover":
      return cached({
        supportedVersions: ["2026-07-28"],
        capabilities: {
          resources: {},
          extensions: { [extension]: {} },
        },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "skills-example",
            version: "1.0.0",
          },
        },
      });
    case "ping":
      return { resultType: "complete" };
    // スキルのメタデータ一覧を返す
    case "skills/list":
      return cached({ skills: [skill] });
    // URI で指定したスキルのメタデータを返す
    case "skills/get":
      if (params.uri !== uri) invalid("Unknown skill");
      return cached({ skill });
    case "resources/list":
      return cached({
        resources: [...files.keys()].map((uri) => ({
          uri,
          name:
            uri === skill.uri ? skill.frontmatter.name : uri.split("/").at(-1),
          mimeType: "text/markdown",
          ...(uri === skill.uri
            ? { description: skill.frontmatter.description }
            : {}),
        })),
      });
    case "resources/templates/list":
      return cached({ resourceTemplates: [] });
    // URI で指定したリソースの内容を返す。SKILL.md も参照ファイルもここで返す
    case "resources/read": {
      const bytes = files.get(params.uri);
      if (!bytes) invalid("Unknown resource");
      return cached({
        contents: [
          {
            uri: params.uri,
            mimeType: "text/markdown",
            text: bytes.toString("utf8"),
          },
        ],
      });
    }
    default:
      throw { code: -32601, message: "Method not found" };
  }
}

// stdio では、1 行につき 1 つの JSON-RPC メッセージを送受信する。
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let request;
  let response;
  try {
    request = JSON.parse(line);
    if (!("id" in request)) continue;
    const result = dispatch(request.method, request.params);
    response = { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    response = {
      jsonrpc: "2.0",
      ...(request?.id != null ? { id: request.id } : {}),
      error: {
        code: error.code ?? (error instanceof SyntaxError ? -32700 : -32603),
        message: error.message ?? "Internal error",
      },
    };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
