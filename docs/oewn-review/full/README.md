# OEWN 全量审核资料

基于 main `83edf56cbe45fdd95ad7aab54565c6e921fb8e47`。资料准备日期：2026-11-04。只整理离线资料，没有修改代码业务、数据库、priority、pilot 或导入 SQL。

## 文件

- `OEWN_AI_Review_Full.xlsx`：7 张表——总览、全部 NGSL 词头、精确 senses、26 pilot、大小写词头、大小写候选、未匹配词头。可筛选，表头和前两列冻结，黄色列供审核填写。
- `exact_senses.csv/.tsv`：全部 19,028 条精确候选，含原排名、词头、归一化词头、sense ID、POS、英文释义、来源例句、IPA、原 priority、source entry ref、source/version/license/hash、原 SQL 文件／行号／hash、原 OEWN POS 分组。
- `ngsl_headwords.csv/.tsv`：全部 2,809 词及原排名／SFI／频率、匹配类别、歧义、pilot 锁定和空白 AI 审核列。
- `reviewed_pilot.csv/.tsv`：26 已审核 senses，是 exact_senses 的子集，不能再追加至全集。
- `case_only_headwords.csv/.tsv`：5 词；`case_only_senses.csv/.tsv`：其 29 条附录候选，不在 19,028 条正式导入内，原 priority 为空。
- `unmatched_headwords.csv/.tsv`：62 无匹配词及说明，没有伪造 senses。
- `AI_REVIEW_INSTRUCTIONS.md`：交给高级 AI 的审核说明和结果 JSONL 格式。
- `canonical.json`：所有导出表的结构化数据，保留 null 和数字类型。
- `provenance.json`、`validation_report.json`、`original_import_manifest.json`、`PACKAGE_MANIFEST.json`：来源、验证结果、原导入 manifest、资料包文件哈希。
- 原 NGSL CSV、NGSL 来源说明、OEWN 版权免责声明一并保留。

## 数量与使用约定

2,742 个精确词头、19,028 个不同 sense ID；26 priority 100、19,002 priority 0；5 个大小写词头（29 senses）、62 无匹配词，共覆盖 2,809 词。

CSV/TSV 均为 UTF-8 无 BOM，带标题行。使用标准 CSV 解析器（TSV delimiter 为 Tab），字段内特殊字符使用引号转义。空来源字段表示 null／来源未提供，不是零。Excel 的源空白同义。ID 是字符串。多文件是同数据的不同视图，禁止拼接重复。

定义、例句、音标严格沿用原导入包：首条非空 synset 定义／例句，US IPA 优先、其次 GB、再首条。不声称包含完整词典的所有例句或所有发音。例句可能使用同义词，不能自行换词后仍称来源例句。

精确词形匹配不代表意义合适。实际大小写清单：it→IT、or→OR、who→WHO、TRUE→true、FALSE→false。原始大小写包括 I、TRUE、FALSE 必须保留。

源包的全部 15 个 SQL 文件逐一核对字节数及 SHA-256；全部 sense IDs 和语言字段与固定官方归档对照。26 pilot 全字段与仓库 JSON 相同。最终 CSV/TSV/Excel 逐字段校验结果记录在 validation_report.json。没有运行任何 SQL。

本目录替代旧 `batch-01/` 的范围限制。旧 50 词文件仅为备份历史，不代表已审核、不得作为新批准列表。
