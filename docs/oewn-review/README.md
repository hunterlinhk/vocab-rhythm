# OEWN 审核交接入口

## 当前状态

2026-11-04：全量离线审核准备，分支 `docs/oewn-ai-review-handoff`，基线 main `83edf56cbe45fdd95ad7aab54565c6e921fb8e47`。没有改动应用代码、数据库、priority、pilot、migration 或 `ops/oewn-2025-ngsl/`。

- `full/`：完整 Excel、CSV、TSV、JSON、来源许可、验证报告及高级 AI 审核说明。
- `OEWN_AI_Review_Full_2026-11-04.zip`：可直接交给高级 AI 的完整打包资料，旁边 `.sha256` 核对下载完整性。
- `tooling/`：离线导出、Excel 生成和逐字段验证／打包工具。只读源 SQL，不执行 SQL，不使用网络或数据库密钥。
- `batch-01/`：此前 50 词准备文件的历史备份。已被全量资料取代，不是新增批准列表，不要把其中建议当作审核结论。

本目录 `.gitattributes` 仅对审核资料保留原始字节，避免换电脑时 Git 自动转换换行导致文件哈希失效。TSV 末尾 Tab 是空审核字段，不要清理。

## 换电脑后从哪里继续

1. clone `https://github.com/hunterlinhk/vocab-rhythm.git`，checkout `docs/oewn-ai-review-handoff`；不要误以为此分支已合并 main。
2. 下载 ZIP 并核验 `.sha256`。资料已自包含，日常审核不需要下载原始归档，也不需要本机环境、账号或生产密钥。
3. 把 ZIP 中 `AI_REVIEW_INSTRUCTIONS.md` 给高级 AI，并提供全量 CSV/TSV。所有选择是提案，26 pilot 锁定，未匹配与仅大小写候选只供解释。
4. 收回完整 2,742 行 JSONL，先核对 ID、逐词覆盖、26 pilot、不确定项，再由人工批准。此阶段不要修改 priority 或执行数据库 SQL。

## 生产状态与限制

此前用户提供的 `13-verification.sql` 结果：2,742 lexemes、19,028 senses、26 priority 100、19,002 priority 0，counts/provenance/overall 均为 true。用户要求停在 verification 后；本任务没有执行 `14-cleanup.sql`，也没有重新读取生产库。不要猜测当前 staging 是否仍存在，后续若需清理须重新确认。

先前只读浏览器 smoke test 只确认词库加载、当前拼写页和刷新位置正常；没有完成 26 pilot 的线上逐词核验，也没有提交学习答案。本包的完整性校验是离线资料核验，不是生产学习行为 E2E 通过证明。

没有备份密钥、.env、浏览器登录、用户个人数据库或本机全部文件。本交接覆盖此次 OEWN 资料和继续工作的必要上下文。

## 离线重建（仅需要重建资料时）

从 `provenance.json` 的官方地址获取固定 OEWN 归档并校验 SHA-256。`prepare.py` 会再次检查归档和原导入包全部 SQL 哈希，不信任旧解压目录。

```text
python docs/oewn-review/tooling/prepare.py <english-wordnet-2025-json.zip>
```

Excel 使用独立安装的 `@oai/artifact-tool`（本次由 Codex bundled runtime 提供），不要添加到应用 dependencies。设置 `ARTIFACT_NODE_MODULES` 指向该独立环境的 node_modules，然后：

```text
node --max-old-space-size=8192 docs/oewn-review/tooling/workbook.mjs docs/oewn-review/full <临时预览目录>
python docs/oewn-review/tooling/verify_package.py
```

最后一步对 CSV/TSV/Excel 全字段验证、生成 manifest、ZIP，并复制到当前用户 Desktop。本次复现工具不调用任何数据库。预览 PNG 是临时 QA 文件，不属于审核输入。
