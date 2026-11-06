BEGIN;

INSERT INTO public.lexicon_sources
  (id, title, version, source_url, source_kind, license_id, license_url, attribution,
   access_tier, source_sha256, transformation)
VALUES
  ('cadence-round2-editorial-bccb9a1ab863', 'Cadence Round 2 editorial supplement', 'round2-de9e7a320587',
   'https://github.com/hunterlinhk/vocab-rhythm/tree/main/ops/cadence-round2-editorial/source',
   'editorial', NULL, NULL,
   'Cadence project editorial content; independent of OEWN.', 'restricted', 'de9e7a320587e55d439210a2d3c9c41e0a2a1761fae273fc11ae9fa91ef410ae',
   'Mapped from rewritten_learning_content.json (SHA-256 de9e7a320587e55d439210a2d3c9c41e0a2a1761fae273fc11ae9fa91ef410ae) and round2_decisions.jsonl (SHA-256 1efbc15ab0576ce3537c7c624f22281f2b7ab6dd04220c9241d4c27b102f4cda); original Round 2 decisions retained in review_decision; all rows imported pending review.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
  ('en', 'a', 'a'),
  ('en', 'in', 'in'),
  ('en', 'he', 'he'),
  ('en', 'on', 'on'),
  ('en', 'i', 'I'),
  ('en', 'as', 'as'),
  ('en', 'at', 'at'),
  ('en', 'but', 'but'),
  ('en', 'by', 'by'),
  ('en', 'will', 'will'),
  ('en', 'can', 'can'),
  ('en', 'over', 'over'),
  ('en', 'after', 'after'),
  ('en', 'may', 'may'),
  ('en', 'before', 'before'),
  ('en', 'through', 'through'),
  ('en', 'between', 'between'),
  ('en', 'why', 'why'),
  ('en', 'might', 'might'),
  ('en', 'must', 'must'),
  ('en', 'under', 'under'),
  ('en', 'within', 'within'),
  ('en', 'across', 'across'),
  ('en', 'along', 'along'),
  ('en', 'above', 'above'),
  ('en', 'behind', 'behind'),
  ('en', 'below', 'below'),
  ('en', 'despite', 'despite'),
  ('en', 'beyond', 'beyond'),
  ('en', 'except', 'except'),
  ('en', 'throughout', 'throughout'),
  ('en', 'mine', 'mine'),
  ('en', 'yeah', 'yeah'),
  ('en', 'nobody', 'nobody'),
  ('en', 'asset', 'asset'),
  ('en', 'till', 'till'),
  ('en', 'mobile', 'mobile'),
  ('en', 'hell', 'hell'),
  ('en', 'forth', 'forth'),
  ('en', 'beneath', 'beneath'),
  ('en', 'tale', 'tale'),
  ('en', 'wherever', 'wherever'),
  ('en', 'website', 'website'),
  ('en', 'alongside', 'alongside'),
  ('en', 'alright', 'alright')
ON CONFLICT (language, normalized_word) DO NOTHING;

INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, translation,
   part_of_speech, definition_en, content_type, sense_role, publication_status,
   review_decision, related_sense_key, usage_note_zh)
SELECT l.id, 'cadence-round2-editorial-bccb9a1ab863', NULL, v.sense_key, v.priority, v.translation,
       v.part_of_speech, v.definition_en, v.content_type, v.sense_role,
       v.publication_status, v.review_decision, v.related_sense_key, v.usage_note_zh
FROM (VALUES
  ('a', 'a', 'cadence-round2:a:missing_core_sense', 110, '不定冠词：一个；某个（用于不特指的人或物）', 'indefinite article', 'Used before a singular countable noun when referring to one person or thing that is not already known or identified.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('a', 'a', 'cadence-round2:a:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:a:missing_core_sense', '用于可数名词单数前；元音音素开头时通常用 an。'),
  ('in', 'in', 'cadence-round2:in:missing_core_sense', 110, '在……里面；在……期间', 'preposition', 'Inside a place, container, or area; also used for something happening during a period of time.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('in', 'in', 'cadence-round2:in:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:in:missing_core_sense', '常见于 in a room、in a box、in July、in the morning。'),
  ('he', 'he', 'cadence-round2:he:missing_core_sense', 110, '他；它（指雄性动物）', 'pronoun', 'Used to refer to a male person or animal already mentioned or understood.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('he', 'he', 'cadence-round2:he:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:he:missing_core_sense', '通常作主语。'),
  ('on', 'on', 'cadence-round2:on:missing_core_sense', 110, '在……上；在（某一天或日期）', 'preposition', 'Touching or supported by a surface; also used before a day or date.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('on', 'on', 'cadence-round2:on:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:on:missing_core_sense', '常见于 on the table、on Monday、on June 5。'),
  ('i', 'I', 'cadence-round2:i:missing_core_sense', 110, '我', 'pronoun', 'The person who is speaking or writing, when that person is the subject of a sentence.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('i', 'I', 'cadence-round2:i:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:i:missing_core_sense', '英语中 I 始终大写。'),
  ('as', 'as', 'cadence-round2:as:missing_core_sense', 110, '作为；当……时；因为；和……一样', 'preposition; conjunction; comparison structure', 'In the role or function of; during the time that or because; used in as…as to compare two things as equal in a quality.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('as', 'as', 'cadence-round2:as:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:as:missing_core_sense', '常见结构：work as a teacher；as I was leaving；as tall as。'),
  ('at', 'at', 'cadence-round2:at:missing_core_sense', 110, '在（某个地点或具体时刻）', 'preposition', 'Used for a particular place or point in time.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('at', 'at', 'cadence-round2:at:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:at:missing_core_sense', '常见于 at the door、at school、at 6 o’clock。'),
  ('but', 'but', 'cadence-round2:but:missing_core_sense', 110, '但是；然而', 'conjunction', 'Introduces a statement that contrasts with what was just said.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('but', 'but', 'cadence-round2:but:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:but:missing_core_sense', '连接意思相反或出乎预期的内容。'),
  ('by', 'by', 'cadence-round2:by:missing_core_sense', 110, '被、由；在……旁边；通过、用', 'preposition', 'Shows who performs an action; means near or beside; or tells how something is done.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('by', 'by', 'cadence-round2:by:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:by:missing_core_sense', '被动句中可引出动作执行者；也可表示方式，如 by bus。'),
  ('will', 'will', 'cadence-round2:will:missing_core_sense', 110, '将；会；愿意', 'modal verb', 'Used with a verb to talk about the future, make a prediction, or express willingness or a decision.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('will', 'will', 'cadence-round2:will:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:will:missing_core_sense', '后接动词原形。'),
  ('can', 'can', 'cadence-round2:can:missing_core_sense', 110, '能；会；可以', 'modal verb', 'Used to say that someone is able to do something, knows how to do it, or has permission to do it.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('can', 'can', 'cadence-round2:can:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:can:missing_core_sense', '后接动词原形；也常用于请求或给予许可。'),
  ('over', 'over', 'cadence-round2:over:missing_core_sense', 110, '在……上方；越过；超过', 'preposition', 'Higher than something, sometimes with no contact; from one side to the other; or more than a stated amount.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('over', 'over', 'cadence-round2:over:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:over:missing_core_sense', '具体含义由位置、移动或数量语境决定。'),
  ('after', 'after', 'cadence-round2:after:missing_core_sense', 110, '在……之后', 'preposition; conjunction', 'Later than a particular time, event, or action.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('after', 'after', 'cadence-round2:after:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:after:missing_core_sense', '后面可接名词、时间表达或完整从句。'),
  ('may', 'may', 'cadence-round2:may:missing_core_sense', 110, '可能；可以', 'modal verb', 'Used to say that something is possible, or to ask for or give permission.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('may', 'may', 'cadence-round2:may:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:may:missing_core_sense', '后接动词原形；表示许可时语气通常较正式。'),
  ('before', 'before', 'cadence-round2:before:missing_core_sense', 110, '在……之前', 'preposition; conjunction', 'Earlier than a particular time, event, or action.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('before', 'before', 'cadence-round2:before:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:before:missing_core_sense', '后面可接名词、时间表达或完整从句。'),
  ('through', 'through', 'cadence-round2:through:missing_core_sense', 110, '穿过；通过；借助', 'preposition', 'From one side or end of something to the other, often by going inside it; also by means of something.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('through', 'through', 'cadence-round2:through:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:through:missing_core_sense', '可表示穿过空间，也可表示通过某种方式或途径。'),
  ('between', 'between', 'cadence-round2:between:missing_core_sense', 110, '在……之间', 'preposition', 'In the space or period separating two people, things, places, or points.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('between', 'between', 'cadence-round2:between:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:between:missing_core_sense', '常用于 between A and B。'),
  ('why', 'why', 'cadence-round2:why:missing_core_sense', 110, '为什么；……的原因', 'interrogative adverb', 'Used to ask about or explain the reason for something.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('why', 'why', 'cadence-round2:why:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:why:missing_core_sense', '可用于直接提问，也可引导间接疑问句。'),
  ('might', 'might', 'cadence-round2:might:missing_core_sense', 110, '可能；也许', 'modal verb', 'Used to say that something is possible but uncertain; also used to make a suggestion or request more tentative.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('might', 'might', 'cadence-round2:might:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:might:missing_core_sense', '后接动词原形；语气常比 may 更不确定或更委婉。'),
  ('must', 'must', 'cadence-round2:must:missing_core_sense', 110, '必须；一定', 'modal verb', 'Used to say that something is necessary or required, or to express a strong belief that something is true.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('must', 'must', 'cadence-round2:must:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:must:missing_core_sense', '后接动词原形；具体是义务还是推断取决于语境。'),
  ('under', 'under', 'cadence-round2:under:missing_core_sense', 110, '在……下面；少于；低于', 'preposition', 'Below or covered by something; also less than a stated age, amount, or limit.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('under', 'under', 'cadence-round2:under:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:under:missing_core_sense', '常见于 under the bed、under 18、under $20。'),
  ('within', 'within', 'cadence-round2:within:missing_core_sense', 110, '在……里面；在……以内；不超过', 'preposition', 'Inside the limits of a place, period of time, or amount.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('within', 'within', 'cadence-round2:within:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:within:missing_core_sense', '常见于 within the city、within a week、within budget。'),
  ('across', 'across', 'cadence-round2:across:missing_core_sense', 110, '穿过；横过；在……对面', 'preposition', 'From one side of something to the other, or on the opposite side.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('across', 'across', 'cadence-round2:across:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:across:missing_core_sense', '可表示穿越范围，也可表示位于另一侧。'),
  ('along', 'along', 'cadence-round2:along:missing_core_sense', 110, '沿着；顺着', 'preposition', 'Following the length or direction of something, or at a point on it.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('along', 'along', 'cadence-round2:along:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:along:missing_core_sense', '常见于 along the road、along the river。'),
  ('above', 'above', 'cadence-round2:above:missing_core_sense', 110, '在……上方；高于；超过', 'preposition', 'At or to a higher position or level than something; also more than a stated number or amount.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('above', 'above', 'cadence-round2:above:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:above:missing_core_sense', '常用于位置、等级、数值或前文提及的内容。'),
  ('behind', 'behind', 'cadence-round2:behind:missing_core_sense', 110, '在……后面；落后于', 'preposition', 'At or toward the back of someone or something; also later or less advanced than expected.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('behind', 'behind', 'cadence-round2:behind:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:behind:missing_core_sense', '可表示空间位置，也可表示进度落后。'),
  ('below', 'below', 'cadence-round2:below:missing_core_sense', 110, '在……下面；低于；少于', 'preposition', 'At or to a lower level or position than something; also less than a stated amount or standard.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('below', 'below', 'cadence-round2:below:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:below:missing_core_sense', '常见于 below the surface、below average、below zero。'),
  ('despite', 'despite', 'cadence-round2:despite:missing_core_sense', 110, '尽管；虽然', 'preposition', 'Without being stopped or affected by something; in spite of it.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('despite', 'despite', 'cadence-round2:despite:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:despite:missing_core_sense', '后接名词、代词或动名词；完整句子通常用 despite the fact that。'),
  ('beyond', 'beyond', 'cadence-round2:beyond:missing_core_sense', 110, '在……那边；超出；无法……', 'preposition', 'On or to the farther side of something; more than, or outside the limits of something.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('beyond', 'beyond', 'cadence-round2:beyond:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:beyond:missing_core_sense', '可表示空间、范围、能力或理解上的超出。'),
  ('except', 'except', 'cadence-round2:except:missing_core_sense', 110, '除……之外；不包括', 'preposition; conjunction', 'Not including a person or thing; apart from that person or thing.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('except', 'except', 'cadence-round2:except:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:except:missing_core_sense', '表示把某人或某物从整体中排除。'),
  ('throughout', 'throughout', 'cadence-round2:throughout:missing_core_sense', 110, '遍及；自始至终', 'preposition', 'In every part of a place, or during the whole of a period of time.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('throughout', 'throughout', 'cadence-round2:throughout:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:throughout:missing_core_sense', '可表示空间范围，也可表示整个时间段。'),
  ('mine', 'mine', 'cadence-round2:mine:missing_core_sense', 110, '我的；属于我的东西', 'possessive pronoun', 'A thing that belongs to or is associated with the speaker; used without a following noun.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('mine', 'mine', 'cadence-round2:mine:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:mine:missing_core_sense', 'mine 可独立使用；名词前用 my。'),
  ('yeah', 'yeah', 'cadence-round2:yeah:missing_core_sense', 110, '是的；对；嗯（口语）', 'interjection', 'An informal way to say yes or to show agreement.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('yeah', 'yeah', 'cadence-round2:yeah:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:yeah:missing_core_sense', '比 yes 更口语化。'),
  ('nobody', 'nobody', 'cadence-round2:nobody:missing_core_sense', 110, '没有人；谁也没有', 'pronoun', 'No person; not anyone.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('nobody', 'nobody', 'cadence-round2:nobody:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:nobody:missing_core_sense', '作主语时通常搭配单数动词。'),
  ('asset', 'asset', 'cadence-round2:asset:additional_common_sense', 0, '资产；财产', 'noun (finance)', 'Money, property, or another valuable item owned by a person or organization.', 'sense', 'supplementary', 'pending_review', 'propose_primary', 'asset%1:07:00::', NULL),
  ('asset', 'asset', 'cadence-round2:asset:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:asset:additional_common_sense', '财务语境中可指现金、房产、设备等有价值的所有物。'),
  ('till', 'till', 'cadence-round2:till:missing_core_sense', 110, '直到……为止', 'preposition; conjunction', 'Up to the time when something happens; until.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('till', 'till', 'cadence-round2:till:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:till:missing_core_sense', '常用于时间表达；语体较口语，意思与 until 相同。'),
  ('mobile', 'mobile', 'cadence-round2:mobile:additional_common_sense', 0, '手机（英式英语）', 'noun (British English)', 'A mobile phone.', 'sense', 'supplementary', 'pending_review', 'propose_primary', 'mobile%3:00:00::', NULL),
  ('mobile', 'mobile', 'cadence-round2:mobile:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:mobile:additional_common_sense', '美式英语通常说 cell phone 或 cellphone。'),
  ('hell', 'hell', 'cadence-round2:hell:additional_common_sense', 0, '地狱（宗教概念）', 'noun (religious)', 'In some religions, the place where the souls of wicked people are believed to go after death.', 'sense', 'supplementary', 'pending_review', 'propose_primary', 'hell%1:15:01::', NULL),
  ('hell', 'hell', 'cadence-round2:hell:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:hell:additional_common_sense', '这是宗教义；hell 也常用于非宗教的强烈表达。'),
  ('forth', 'forth', 'cadence-round2:forth:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', 'propose_primary', 'forth%4:02:02::', '单独使用偏正式或文学语体。常见搭配：and so forth（等等）；back and forth（来回）。'),
  ('beneath', 'beneath', 'cadence-round2:beneath:missing_core_sense', 110, '在……下方；在……下面', 'preposition', 'In or to a lower position than something; directly under it.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('beneath', 'beneath', 'cadence-round2:beneath:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:beneath:missing_core_sense', '语体较正式；日常对话中常用 under。'),
  ('tale', 'tale', 'cadence-round2:tale:definition_rewrite', 110, '故事；传说（常涉及虚构或传统故事）', 'noun', 'A story, often about imaginary or traditional events.', 'sense', 'primary', 'pending_review', 'propose_primary', 'tale%1:10:00::', NULL),
  ('tale', 'tale', 'cadence-round2:tale:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:tale:definition_rewrite', '比 story 更常见于文学表达或固定搭配；不表示所有 tale 都一定是虚构的。'),
  ('wherever', 'wherever', 'cadence-round2:wherever:missing_core_sense', 110, '无论在哪里；无论到哪里', 'conjunction', 'In, at, or to any place; no matter where.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('wherever', 'wherever', 'cadence-round2:wherever:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:wherever:missing_core_sense', '常引导表示地点的从句。'),
  ('website', 'website', 'cadence-round2:website:definition_rewrite', 110, '网站：通过同一网址访问的一组相关网页', 'noun', 'A group of related pages on the internet, usually available under one web address and maintained by a person or organization.', 'sense', 'primary', 'pending_review', 'propose_primary', 'website%1:10:00::', NULL),
  ('website', 'website', 'cadence-round2:website:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:website:definition_rewrite', '网站是网页内容的集合，不是提供网页的服务器。'),
  ('alongside', 'alongside', 'cadence-round2:alongside:missing_core_sense', 110, '在……旁边；与……一起', 'preposition', 'Next to or at the side of something; also together with someone or something.', 'sense', 'primary', 'pending_review', 'defer_no_suitable_sense', NULL, NULL),
  ('alongside', 'alongside', 'cadence-round2:alongside:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', NULL, 'cadence-round2:alongside:missing_core_sense', '可表示并列的位置，也可表示共同参与。'),
  ('alright', 'alright', 'cadence-round2:alright:usage_note', 0, NULL, NULL, NULL, 'usage_note', NULL, 'pending_review', 'propose_primary', 'alright%4:02:02::', 'alright 是 all right 的非正式拼写形式；正式写作中通常使用 all right。')
) AS v(normalized_word, lemma, sense_key, priority, translation, part_of_speech,
       definition_en, content_type, sense_role, publication_status, review_decision,
       related_sense_key, usage_note_zh)
JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO NOTHING;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863';
  IF v_count <> 88 THEN RAISE EXCEPTION 'Expected 88 editorial rows, got %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_sources WHERE id = 'cadence-round2-editorial-bccb9a1ab863' AND (source_kind <> 'editorial' OR access_tier <> 'restricted'))
    THEN RAISE EXCEPTION 'Editorial source must remain restricted'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND publication_status <> 'pending_review')
    THEN RAISE EXCEPTION 'Editorial rows must remain pending review'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'sense') <> 43
    THEN RAISE EXCEPTION 'Expected 43 sense rows'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'usage_note') <> 45
    THEN RAISE EXCEPTION 'Expected 45 usage-note rows'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'sense' AND sense_role = 'primary') <> 40
    THEN RAISE EXCEPTION 'Expected 40 primary senses'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'sense' AND sense_role = 'supplementary') <> 3
    THEN RAISE EXCEPTION 'Expected 3 supplementary senses'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND review_decision = 'defer_no_suitable_sense') <> 38
    THEN RAISE EXCEPTION 'Expected 38 deferred audit decisions'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND review_decision = 'propose_primary') <> 7
    THEN RAISE EXCEPTION 'Expected 7 proposed audit decisions'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'usage_note'
    AND (usage_note_zh IS NULL OR related_sense_key IS NULL))
    THEN RAISE EXCEPTION 'Every usage note must be non-empty and linked to a sense'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'usage_note'
    AND (sense_role IS NOT NULL OR translation IS NOT NULL OR definition_en IS NOT NULL OR part_of_speech IS NOT NULL))
    THEN RAISE EXCEPTION 'Usage notes must remain separate from sense fields'; END IF;
  IF EXISTS (SELECT lexeme_id FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND content_type = 'usage_note' GROUP BY lexeme_id HAVING count(*) <> 1)
    THEN RAISE EXCEPTION 'Each headword must have exactly one usage note'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries n WHERE n.source_id = 'cadence-round2-editorial-bccb9a1ab863' AND n.content_type = 'usage_note'
      AND n.related_sense_key LIKE 'cadence-round2:%'
      AND EXISTS (SELECT 1 FROM public.lexicon_entries s WHERE s.source_id = n.source_id AND s.lexeme_id = n.lexeme_id AND s.content_type = 'sense' AND s.sense_key = n.related_sense_key)) <> 43
    THEN RAISE EXCEPTION 'Expected 43 usage notes linked to their editorial sense'; END IF;
END $$;

COMMIT;
