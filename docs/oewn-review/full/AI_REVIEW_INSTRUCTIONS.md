# 给高级 AI：OEWN 全量词义审核

## 输入与任务

先读 README.md、provenance.json、validation_report.json，再以 exact_senses.csv 或 TSV 审核全部 **2,742 个精确匹配词头、19,028 条候选 senses**。ngsl_headwords.csv 提供全体 2,809 个词的原始排名、频率、匹配分类和歧义。Excel 是相同数据的可筛选视图，不是另一批数据，不能拼接重复计算。

任务是提出通用英语学习主词义建议，不是批准或部署。优先按 NGSL 排名处理，但最终必须覆盖全部精确词头，包括暂缓项。若上下文不足可内部拆分处理，最后合并并核对完整性；不能仅审前 50 个就声称完成。

## 不可改变的事实

- original_priority 是源事实：26 条为 100、19,002 条为 0。reviewed_pilot 中的 26 个已批准 sense ID、POS、释义、例句、IPA 和 priority 全部锁定，不重新选义、不替换、不降级。
- 不修改任何输入数据，不生成更新 priority 的 SQL，不执行脚本、数据库或部署操作。输出 proposed_primary_sense_id 只是待人工确认的建议。
- 词书只决定词与顺序；Shared Lexicon 提供语言数据，Review 调度独立。本审核不改变用户数据、词书身份、学习流程或 Review 设置。
- 词头精确匹配不等于词义合适。NGSL 排名、SFI、总词频只针对词头，不提供各 sense 的频率；sense ID 和排列顺序也不代表常用程度。
- 不编造 sense ID、词性、音标、英文释义、中文译文或来源例句。中文可以写审核理由，但不能伪装成 OEWN 提供的中文释义。
- 原始大小写必须保留，尤其 I、TRUE、FALSE。normalized_word 用于解释现有数据，不能据此合并不同原始词头或偷换候选。

## 逐词判断

1. 若 review_status=pilot_locked，保持 reviewed_pilot_sense_ids，返回 preserve_pilot，不重新挑主词义。该词其他未审核候选仍保留，但不得覆盖 pilot。
2. 对其余 **2,716** 个词阅读全部候选，判断基础词汇义、缺失的语法用法、字母名、元素、缩写、单位、专业义、古义、互相重叠义。
3. 有明确适合通用学习的义项时，可以作一个教学推荐，解释选择理由、关键备选、例句可用性和不确定点。不得在没有独立语料证据时宣称“这是最高频词义”。
4. 多个基础义同样合理且无法确定优先时，列出 competing_sense_ids，返回 needs_human，不强行选择。不同词性之间的取舍必须明确说明。
5. 若缺通常要教的意义，返回 defer_no_suitable_sense。特别注意 a（字母）、he（希伯来字母）、I（元素／数字／字母）、at（货币）、can（缺“能够”）、will（缺助动词）。不得为了填满数据把无关意义作为默认词义。
6. 对仅有适合教学的次义、却缺基础语法义的词，标记 partial_coverage。as、about、in、on、by、but 等要核对词性和用法，不能把一个副词义解释成完整的介词／连词用法。
7. source_example 是现有导入包保留的首条可用 synset 例句，可能使用同义词，未必含目标词。分别标 usable_as_is、target_lemma_absent、missing、needs_human；不能简单替换单词或编句后仍说是 OEWN 来源。词形变化需语义核对，不能只按字符串判错。
8. IPA 是导入器选择的单条发音（US 优先，其次 GB，其次首条），不是所有地区、词性和义项的完整发音。空字段表示来源未提供，不是允许补造。

## 排除项

case_only_headwords 中实际是 it→IT、or→OR、who→WHO、TRUE→true、FALSE→false。其 29 个 senses 只在 case_only_senses 附录，**不在正式 19,028 条内，也没有原始 priority**。前三者存在缩写碰撞；后两者也需先确认原始大小写身份。不得自动导入或混入精确词义审批。

unmatched_headwords 有 62 个词，固定版本中没有精确或仅大小写词头匹配。只说明缺失，不猜测其他词形或同义词，不生成候选。

## 返回格式

返回 UTF-8 JSONL，每个精确词头一个对象，共 **2,742 行**，字段如下：

```json
{"ngsl_rank":2,"headword":"be","decision":"needs_human","proposed_primary_sense_id":null,"competing_sense_ids":["be%2:42:03::","be%2:42:00::"],"review_rationale":"系词与存在义均基础，需确认教学优先级","uncertainty":"NGSL 总词频不能决定两个义项的频率","flags":["multiple_senses"],"example_assessment":"needs_human","pilot_preserved":false}
```

decision 只能是：propose_primary、needs_human、defer_no_suitable_sense、preserve_pilot。

- propose_primary：恰好一个该原始词头下现有的精确 sense ID。
- needs_human / defer：主 ID 为 null；竞争 ID 只能来自同一词头的精确候选。
- preserve_pilot：主 ID 必须是原已批准 priority 100 ID，pilot_preserved=true。

另返回 5 个 case_only 与 62 个 unmatched 的说明，标为 excluded_from_exact_review，不进入上述 2,742 行。附简短汇总和所有待人工决定事项。

## 输出完整性

核对 2,742 个不同精确词头、每词一条结果、19,028 个不同输入 ID、26 pilot 原样保留、最多涉及 2,716 个新词义建议。每个推荐／竞争 ID 必须属于该词。四类 decision 总数必须为 2,742；2,742+5+62=2,809。

必须列出未完成、语义错配、多义取舍、缺失语法义、例句问题、IPA 缺失，不得用“审核通过”隐藏。所有建议仍需人工确认，不把 AI 输出当成已经批准的 priority。

## 来源

完整 source/version/license/attribution/hash 在 provenance.json；原始 SQL manifest 在 original_import_manifest.json。OEWN CC BY 4.0，含 Princeton WordNet License，完整版权免责声明在 OEWN-WNDB-LICENSE.txt。NGSL CC BY-SA 4.0，见 NGSL-SOURCE.md。不得把这两种来源与 AI 审核理由混为同一来源。
