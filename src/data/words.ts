import { NGSL_BOOK_ID, NGSL_WORDS } from "./ngsl";

/** Only the headword is required; study content may be added independently later. */
export type WordEntry = {
  word: string;
  /** 词条所属词书（复习队列会混合多本词书，用于按词书记录） */
  bookId?: string | undefined;
  /** Published source statistics, when available. */
  rank?: number | undefined;
  sfi?: number | undefined;
  frequencyPerMillion?: number | undefined;
  /** Optional editorial learning fields. */
  partOfSpeech?: string | undefined;
  phonetic?: string | undefined;
  cn?: string | undefined;
  sentence?: string | undefined;
  sentenceCn?: string | undefined;
  subject?: string | undefined;
  verb?: string | undefined;
  object?: string | undefined;
  svo?: { s: string; v: string; o?: string | undefined } | undefined;
};

export type WordBook = {
  id: string;
  name: string;
  desc: string;
  words: WordEntry[];
  /** official = 系统维护，custom = 用户自建 */
  source: "official" | "custom";
  /** 内置演示词库：仅用于开发测试，并非正式授权词库 */
  demo?: boolean;
};

export type MeaningfulEntry = WordEntry & { cn: string };
export type SentenceEntry = WordEntry & { sentence: string };

const core: WordEntry[] = [
  { word: "achieve", phonetic: "/əˈtʃiːv/", cn: "v. 实现，达到", sentence: "She achieved her goal.", sentenceCn: "她实现了她的目标。", svo: { s: "She", v: "achieved", o: "her goal" } },
  { word: "ability", phonetic: "/əˈbɪləti/", cn: "n. 能力", sentence: "He has a rare ability.", sentenceCn: "他拥有一种罕见的能力。", svo: { s: "He", v: "has", o: "a rare ability" } },
  { word: "absorb", phonetic: "/əbˈzɔːrb/", cn: "v. 吸收", sentence: "Plants absorb sunlight.", sentenceCn: "植物吸收阳光。", svo: { s: "Plants", v: "absorb", o: "sunlight" } },
  { word: "account", phonetic: "/əˈkaʊnt/", cn: "n. 账户；说明", sentence: "I opened a new account.", sentenceCn: "我开了一个新账户。", svo: { s: "I", v: "opened", o: "a new account" } },
  { word: "adapt", phonetic: "/əˈdæpt/", cn: "v. 适应", sentence: "Children adapt quickly.", sentenceCn: "孩子们适应得很快。", svo: { s: "Children", v: "adapt" } },
  { word: "admire", phonetic: "/ədˈmaɪər/", cn: "v. 钦佩", sentence: "We admire her courage.", sentenceCn: "我们钦佩她的勇气。", svo: { s: "We", v: "admire", o: "her courage" } },
  { word: "advance", phonetic: "/ədˈvæns/", cn: "n./v. 前进，进步", sentence: "Technology advances fast.", sentenceCn: "技术进步很快。", svo: { s: "Technology", v: "advances" } },
  { word: "analyze", phonetic: "/ˈænəlaɪz/", cn: "v. 分析", sentence: "They analyze the data.", sentenceCn: "他们分析这些数据。", svo: { s: "They", v: "analyze", o: "the data" } },
  { word: "ancient", phonetic: "/ˈeɪnʃənt/", cn: "adj. 古代的", sentence: "We visited an ancient city.", sentenceCn: "我们参观了一座古城。", svo: { s: "We", v: "visited", o: "an ancient city" } },
  { word: "apply", phonetic: "/əˈplaɪ/", cn: "v. 申请；应用", sentence: "He applied for the job.", sentenceCn: "他申请了这份工作。", svo: { s: "He", v: "applied" } },
  { word: "approach", phonetic: "/əˈproʊtʃ/", cn: "n. 方法 v. 接近", sentence: "Winter is approaching.", sentenceCn: "冬天正在临近。", svo: { s: "Winter", v: "is approaching" } },
  { word: "argue", phonetic: "/ˈɑːrɡjuː/", cn: "v. 争论", sentence: "They argue every day.", sentenceCn: "他们每天都在争论。", svo: { s: "They", v: "argue" } },
  { word: "attitude", phonetic: "/ˈætɪtuːd/", cn: "n. 态度", sentence: "Her attitude changed everything.", sentenceCn: "她的态度改变了一切。", svo: { s: "Her attitude", v: "changed", o: "everything" } },
  { word: "balance", phonetic: "/ˈbæləns/", cn: "n. 平衡", sentence: "He lost his balance.", sentenceCn: "他失去了平衡。", svo: { s: "He", v: "lost", o: "his balance" } },
  { word: "benefit", phonetic: "/ˈbenɪfɪt/", cn: "n. 益处", sentence: "Exercise brings real benefits.", sentenceCn: "运动带来实实在在的好处。", svo: { s: "Exercise", v: "brings", o: "real benefits" } },
  { word: "capable", phonetic: "/ˈkeɪpəbl/", cn: "adj. 有能力的", sentence: "She is capable of more.", sentenceCn: "她能做到更多。", svo: { s: "She", v: "is", o: "capable" } },
  { word: "challenge", phonetic: "/ˈtʃælɪndʒ/", cn: "n. 挑战", sentence: "I enjoy a good challenge.", sentenceCn: "我喜欢有挑战的事。", svo: { s: "I", v: "enjoy", o: "a good challenge" } },
  { word: "complex", phonetic: "/kəmˈpleks/", cn: "adj. 复杂的", sentence: "The problem looks complex.", sentenceCn: "这个问题看起来很复杂。", svo: { s: "The problem", v: "looks", o: "complex" } },
  { word: "concept", phonetic: "/ˈkɑːnsept/", cn: "n. 概念", sentence: "He explained the concept clearly.", sentenceCn: "他清楚地解释了这个概念。", svo: { s: "He", v: "explained", o: "the concept" } },
  { word: "confident", phonetic: "/ˈkɑːnfɪdənt/", cn: "adj. 自信的", sentence: "You sound confident today.", sentenceCn: "你今天听起来很自信。", svo: { s: "You", v: "sound", o: "confident" } },
  { word: "consider", phonetic: "/kənˈsɪdər/", cn: "v. 考虑", sentence: "Please consider my offer.", sentenceCn: "请考虑我的提议。", svo: { s: "You", v: "consider", o: "my offer" } },
  { word: "contain", phonetic: "/kənˈteɪn/", cn: "v. 包含", sentence: "This box contains books.", sentenceCn: "这个盒子装着书。", svo: { s: "This box", v: "contains", o: "books" } },
  { word: "create", phonetic: "/kriˈeɪt/", cn: "v. 创造", sentence: "Artists create beauty.", sentenceCn: "艺术家创造美。", svo: { s: "Artists", v: "create", o: "beauty" } },
  { word: "decline", phonetic: "/dɪˈklaɪn/", cn: "v. 下降；拒绝", sentence: "Sales declined last month.", sentenceCn: "上个月销售额下降了。", svo: { s: "Sales", v: "declined" } },
  { word: "describe", phonetic: "/dɪˈskraɪb/", cn: "v. 描述", sentence: "Describe the picture briefly.", sentenceCn: "简要描述这幅画。", svo: { s: "You", v: "describe", o: "the picture" } },
  { word: "develop", phonetic: "/dɪˈveləp/", cn: "v. 发展", sentence: "We develop new habits slowly.", sentenceCn: "我们慢慢养成新习惯。", svo: { s: "We", v: "develop", o: "new habits" } },
  { word: "effort", phonetic: "/ˈefərt/", cn: "n. 努力", sentence: "Your effort matters most.", sentenceCn: "你的努力最重要。", svo: { s: "Your effort", v: "matters" } },
  { word: "enable", phonetic: "/ɪˈneɪbl/", cn: "v. 使能够", sentence: "Practice enables progress.", sentenceCn: "练习使进步成为可能。", svo: { s: "Practice", v: "enables", o: "progress" } },
  { word: "essential", phonetic: "/ɪˈsenʃl/", cn: "adj. 必要的", sentence: "Sleep is essential.", sentenceCn: "睡眠是必不可少的。", svo: { s: "Sleep", v: "is", o: "essential" } },
  { word: "establish", phonetic: "/ɪˈstæblɪʃ/", cn: "v. 建立", sentence: "They established a school.", sentenceCn: "他们建立了一所学校。", svo: { s: "They", v: "established", o: "a school" } },
  { word: "evidence", phonetic: "/ˈevɪdəns/", cn: "n. 证据", sentence: "The evidence supports him.", sentenceCn: "证据支持他。", svo: { s: "The evidence", v: "supports", o: "him" } },
  { word: "familiar", phonetic: "/fəˈmɪliər/", cn: "adj. 熟悉的", sentence: "This song sounds familiar.", sentenceCn: "这首歌听起来很熟悉。", svo: { s: "This song", v: "sounds", o: "familiar" } },
  { word: "focus", phonetic: "/ˈfoʊkəs/", cn: "v./n. 专注", sentence: "Focus on one task.", sentenceCn: "专注于一件事。", svo: { s: "You", v: "focus" } },
  { word: "gradually", phonetic: "/ˈɡrædʒuəli/", cn: "adv. 逐渐地", sentence: "The sky gradually cleared.", sentenceCn: "天空渐渐放晴。", svo: { s: "The sky", v: "cleared" } },
  { word: "identify", phonetic: "/aɪˈdentɪfaɪ/", cn: "v. 识别", sentence: "Can you identify the sound?", sentenceCn: "你能辨认出这个声音吗？", svo: { s: "You", v: "identify", o: "the sound" } },
  { word: "improve", phonetic: "/ɪmˈpruːv/", cn: "v. 改善", sentence: "Your writing improved a lot.", sentenceCn: "你的写作提高了很多。", svo: { s: "Your writing", v: "improved" } },
  { word: "influence", phonetic: "/ˈɪnfluəns/", cn: "n./v. 影响", sentence: "Books influence our thinking.", sentenceCn: "书籍影响我们的思维。", svo: { s: "Books", v: "influence", o: "our thinking" } },
  { word: "maintain", phonetic: "/meɪnˈteɪn/", cn: "v. 维持", sentence: "Maintain a steady pace.", sentenceCn: "保持稳定的节奏。", svo: { s: "You", v: "maintain", o: "a steady pace" } },
  { word: "obvious", phonetic: "/ˈɑːbviəs/", cn: "adj. 明显的", sentence: "The answer is obvious.", sentenceCn: "答案是显而易见的。", svo: { s: "The answer", v: "is", o: "obvious" } },
  { word: "perform", phonetic: "/pərˈfɔːrm/", cn: "v. 表演；执行", sentence: "The band performed well.", sentenceCn: "乐队表现得很好。", svo: { s: "The band", v: "performed" } },
];

const daily: WordEntry[] = [
  { word: "breakfast", phonetic: "/ˈbrekfəst/", cn: "n. 早餐", sentence: "I skipped breakfast today.", sentenceCn: "我今天没吃早饭。", svo: { s: "I", v: "skipped", o: "breakfast" } },
  { word: "neighbor", phonetic: "/ˈneɪbər/", cn: "n. 邻居", sentence: "My neighbor grows roses.", sentenceCn: "我的邻居种玫瑰。", svo: { s: "My neighbor", v: "grows", o: "roses" } },
  { word: "umbrella", phonetic: "/ʌmˈbrelə/", cn: "n. 雨伞", sentence: "Take an umbrella with you.", sentenceCn: "带上一把伞。", svo: { s: "You", v: "take", o: "an umbrella" } },
  { word: "kitchen", phonetic: "/ˈkɪtʃɪn/", cn: "n. 厨房", sentence: "The kitchen smells wonderful.", sentenceCn: "厨房里香气扑鼻。", svo: { s: "The kitchen", v: "smells", o: "wonderful" } },
  { word: "grocery", phonetic: "/ˈɡroʊsəri/", cn: "n. 杂货", sentence: "We need grocery shopping.", sentenceCn: "我们需要去买点杂货。", svo: { s: "We", v: "need", o: "grocery shopping" } },
  { word: "laundry", phonetic: "/ˈlɔːndri/", cn: "n. 要洗的衣物", sentence: "He folded the laundry.", sentenceCn: "他叠好了洗好的衣服。", svo: { s: "He", v: "folded", o: "the laundry" } },
  { word: "weather", phonetic: "/ˈweðər/", cn: "n. 天气", sentence: "The weather turned cold.", sentenceCn: "天气变冷了。", svo: { s: "The weather", v: "turned", o: "cold" } },
  { word: "traffic", phonetic: "/ˈtræfɪk/", cn: "n. 交通", sentence: "Traffic slowed us down.", sentenceCn: "交通让我们慢了下来。", svo: { s: "Traffic", v: "slowed", o: "us" } },
  { word: "station", phonetic: "/ˈsteɪʃn/", cn: "n. 车站", sentence: "I waited at the station.", sentenceCn: "我在车站等着。", svo: { s: "I", v: "waited" } },
  { word: "ticket", phonetic: "/ˈtɪkɪt/", cn: "n. 票", sentence: "She bought two tickets.", sentenceCn: "她买了两张票。", svo: { s: "She", v: "bought", o: "two tickets" } },
  { word: "luggage", phonetic: "/ˈlʌɡɪdʒ/", cn: "n. 行李", sentence: "My luggage arrived late.", sentenceCn: "我的行李到得很晚。", svo: { s: "My luggage", v: "arrived" } },
  { word: "holiday", phonetic: "/ˈhɑːlədeɪ/", cn: "n. 假日", sentence: "We planned a short holiday.", sentenceCn: "我们计划了一个短假。", svo: { s: "We", v: "planned", o: "a short holiday" } },
  { word: "hospital", phonetic: "/ˈhɑːspɪtl/", cn: "n. 医院", sentence: "The hospital opens early.", sentenceCn: "医院开门很早。", svo: { s: "The hospital", v: "opens" } },
  { word: "medicine", phonetic: "/ˈmedɪsn/", cn: "n. 药", sentence: "Take the medicine twice daily.", sentenceCn: "每天服药两次。", svo: { s: "You", v: "take", o: "the medicine" } },
  { word: "exercise", phonetic: "/ˈeksərsaɪz/", cn: "n./v. 锻炼", sentence: "I exercise every morning.", sentenceCn: "我每天早上锻炼。", svo: { s: "I", v: "exercise" } },
  { word: "restaurant", phonetic: "/ˈrestrɑːnt/", cn: "n. 餐厅", sentence: "That restaurant closes at ten.", sentenceCn: "那家餐厅十点关门。", svo: { s: "That restaurant", v: "closes" } },
  { word: "delicious", phonetic: "/dɪˈlɪʃəs/", cn: "adj. 美味的", sentence: "The soup tastes delicious.", sentenceCn: "这汤味道很好。", svo: { s: "The soup", v: "tastes", o: "delicious" } },
  { word: "message", phonetic: "/ˈmesɪdʒ/", cn: "n. 消息", sentence: "He sent a short message.", sentenceCn: "他发了一条短消息。", svo: { s: "He", v: "sent", o: "a short message" } },
  { word: "afternoon", phonetic: "/ˌæftərˈnuːn/", cn: "n. 下午", sentence: "We meet this afternoon.", sentenceCn: "我们今天下午见面。", svo: { s: "We", v: "meet" } },
  { word: "birthday", phonetic: "/ˈbɜːrθdeɪ/", cn: "n. 生日", sentence: "Her birthday is tomorrow.", sentenceCn: "她的生日是明天。", svo: { s: "Her birthday", v: "is", o: "tomorrow" } },
  { word: "garden", phonetic: "/ˈɡɑːrdn/", cn: "n. 花园", sentence: "The garden looks lovely.", sentenceCn: "花园看起来很可爱。", svo: { s: "The garden", v: "looks", o: "lovely" } },
  { word: "window", phonetic: "/ˈwɪndoʊ/", cn: "n. 窗户", sentence: "Please close the window.", sentenceCn: "请关上窗户。", svo: { s: "You", v: "close", o: "the window" } },
  { word: "morning", phonetic: "/ˈmɔːrnɪŋ/", cn: "n. 早晨", sentence: "The morning felt quiet.", sentenceCn: "早晨很安静。", svo: { s: "The morning", v: "felt", o: "quiet" } },
  { word: "library", phonetic: "/ˈlaɪbreri/", cn: "n. 图书馆", sentence: "I study in the library.", sentenceCn: "我在图书馆学习。", svo: { s: "I", v: "study" } },
  { word: "teacher", phonetic: "/ˈtiːtʃər/", cn: "n. 老师", sentence: "The teacher praised us.", sentenceCn: "老师表扬了我们。", svo: { s: "The teacher", v: "praised", o: "us" } },
  { word: "homework", phonetic: "/ˈhoʊmwɜːrk/", cn: "n. 家庭作业", sentence: "He finished his homework.", sentenceCn: "他完成了作业。", svo: { s: "He", v: "finished", o: "his homework" } },
  { word: "friendly", phonetic: "/ˈfrendli/", cn: "adj. 友好的", sentence: "The staff were friendly.", sentenceCn: "工作人员很友好。", svo: { s: "The staff", v: "were", o: "friendly" } },
  { word: "package", phonetic: "/ˈpækɪdʒ/", cn: "n. 包裹", sentence: "A package arrived for you.", sentenceCn: "有你的一个包裹。", svo: { s: "A package", v: "arrived" } },
  { word: "shoulder", phonetic: "/ˈʃoʊldər/", cn: "n. 肩膀", sentence: "My shoulder hurts today.", sentenceCn: "我今天肩膀疼。", svo: { s: "My shoulder", v: "hurts" } },
  { word: "bicycle", phonetic: "/ˈbaɪsɪkl/", cn: "n. 自行车", sentence: "She rides a bicycle.", sentenceCn: "她骑自行车。", svo: { s: "She", v: "rides", o: "a bicycle" } },
];

const business: WordEntry[] = [
  { word: "budget", phonetic: "/ˈbʌdʒɪt/", cn: "n. 预算", sentence: "We cut the budget.", sentenceCn: "我们削减了预算。", svo: { s: "We", v: "cut", o: "the budget" } },
  { word: "client", phonetic: "/ˈklaɪənt/", cn: "n. 客户", sentence: "The client approved the plan.", sentenceCn: "客户批准了方案。", svo: { s: "The client", v: "approved", o: "the plan" } },
  { word: "colleague", phonetic: "/ˈkɑːliːɡ/", cn: "n. 同事", sentence: "My colleague joined the call.", sentenceCn: "我的同事加入了通话。", svo: { s: "My colleague", v: "joined", o: "the call" } },
  { word: "contract", phonetic: "/ˈkɑːntrækt/", cn: "n. 合同", sentence: "They signed the contract.", sentenceCn: "他们签了合同。", svo: { s: "They", v: "signed", o: "the contract" } },
  { word: "deadline", phonetic: "/ˈdedlaɪn/", cn: "n. 截止日期", sentence: "The deadline moved earlier.", sentenceCn: "截止日期提前了。", svo: { s: "The deadline", v: "moved" } },
  { word: "revenue", phonetic: "/ˈrevənuː/", cn: "n. 收入", sentence: "Revenue grew this quarter.", sentenceCn: "本季度收入增长了。", svo: { s: "Revenue", v: "grew" } },
  { word: "strategy", phonetic: "/ˈstrætədʒi/", cn: "n. 战略", sentence: "Our strategy works well.", sentenceCn: "我们的策略效果很好。", svo: { s: "Our strategy", v: "works" } },
  { word: "negotiate", phonetic: "/nɪˈɡoʊʃieɪt/", cn: "v. 谈判", sentence: "They negotiate the price.", sentenceCn: "他们商议价格。", svo: { s: "They", v: "negotiate", o: "the price" } },
  { word: "invest", phonetic: "/ɪnˈvest/", cn: "v. 投资", sentence: "She invests in startups.", sentenceCn: "她投资初创公司。", svo: { s: "She", v: "invests" } },
  { word: "profit", phonetic: "/ˈprɑːfɪt/", cn: "n. 利润", sentence: "Profit doubled last year.", sentenceCn: "去年利润翻了一番。", svo: { s: "Profit", v: "doubled" } },
  { word: "manager", phonetic: "/ˈmænɪdʒər/", cn: "n. 经理", sentence: "The manager reviewed my report.", sentenceCn: "经理审阅了我的报告。", svo: { s: "The manager", v: "reviewed", o: "my report" } },
  { word: "schedule", phonetic: "/ˈskedʒuːl/", cn: "n. 日程", sentence: "Check the schedule first.", sentenceCn: "先看看日程。", svo: { s: "You", v: "check", o: "the schedule" } },
  { word: "customer", phonetic: "/ˈkʌstəmər/", cn: "n. 顾客", sentence: "Customers love the design.", sentenceCn: "顾客喜欢这个设计。", svo: { s: "Customers", v: "love", o: "the design" } },
  { word: "product", phonetic: "/ˈprɑːdʌkt/", cn: "n. 产品", sentence: "The product launches Friday.", sentenceCn: "产品周五发布。", svo: { s: "The product", v: "launches" } },
  { word: "quality", phonetic: "/ˈkwɑːləti/", cn: "n. 质量", sentence: "Quality beats quantity.", sentenceCn: "质量胜过数量。", svo: { s: "Quality", v: "beats", o: "quantity" } },
  { word: "efficient", phonetic: "/ɪˈfɪʃnt/", cn: "adj. 高效的", sentence: "The team stays efficient.", sentenceCn: "团队保持高效。", svo: { s: "The team", v: "stays", o: "efficient" } },
  { word: "proposal", phonetic: "/prəˈpoʊzl/", cn: "n. 提案", sentence: "I sent the proposal.", sentenceCn: "我发出了提案。", svo: { s: "I", v: "sent", o: "the proposal" } },
  { word: "feedback", phonetic: "/ˈfiːdbæk/", cn: "n. 反馈", sentence: "Your feedback helps us.", sentenceCn: "你的反馈帮助了我们。", svo: { s: "Your feedback", v: "helps", o: "us" } },
  { word: "meeting", phonetic: "/ˈmiːtɪŋ/", cn: "n. 会议", sentence: "The meeting ended early.", sentenceCn: "会议提前结束了。", svo: { s: "The meeting", v: "ended" } },
  { word: "colleagues", phonetic: "/ˈkɑːliːɡz/", cn: "n. 同事们", sentence: "My colleagues support me.", sentenceCn: "我的同事们支持我。", svo: { s: "My colleagues", v: "support", o: "me" } },
  { word: "supply", phonetic: "/səˈplaɪ/", cn: "n./v. 供应", sentence: "They supply fresh coffee.", sentenceCn: "他们供应新鲜咖啡。", svo: { s: "They", v: "supply", o: "fresh coffee" } },
  { word: "demand", phonetic: "/dɪˈmænd/", cn: "n. 需求", sentence: "Demand keeps rising.", sentenceCn: "需求持续上升。", svo: { s: "Demand", v: "rises" } },
  { word: "market", phonetic: "/ˈmɑːrkɪt/", cn: "n. 市场", sentence: "The market reacted quickly.", sentenceCn: "市场反应迅速。", svo: { s: "The market", v: "reacted" } },
  { word: "brand", phonetic: "/brænd/", cn: "n. 品牌", sentence: "The brand feels premium.", sentenceCn: "这个品牌感觉很高端。", svo: { s: "The brand", v: "feels", o: "premium" } },
  { word: "invoice", phonetic: "/ˈɪnvɔɪs/", cn: "n. 发票", sentence: "Please send the invoice.", sentenceCn: "请发送发票。", svo: { s: "You", v: "send", o: "the invoice" } },
  { word: "partner", phonetic: "/ˈpɑːrtnər/", cn: "n. 合作伙伴", sentence: "We found a good partner.", sentenceCn: "我们找到了好的合作伙伴。", svo: { s: "We", v: "found", o: "a good partner" } },
  { word: "target", phonetic: "/ˈtɑːrɡɪt/", cn: "n. 目标", sentence: "We hit the target.", sentenceCn: "我们达成了目标。", svo: { s: "We", v: "hit", o: "the target" } },
  { word: "growth", phonetic: "/ɡroʊθ/", cn: "n. 增长", sentence: "Growth slowed a little.", sentenceCn: "增长略有放缓。", svo: { s: "Growth", v: "slowed" } },
  { word: "report", phonetic: "/rɪˈpɔːrt/", cn: "n. 报告", sentence: "The report looks solid.", sentenceCn: "这份报告很扎实。", svo: { s: "The report", v: "looks", o: "solid" } },
  { word: "decision", phonetic: "/dɪˈsɪʒn/", cn: "n. 决定", sentence: "The decision came fast.", sentenceCn: "决定来得很快。", svo: { s: "The decision", v: "came" } },
];

const tag = (id: string, list: WordEntry[]) => list.map((w) => ({
  ...w,
  bookId: id,
  subject: w.subject ?? w.svo?.s,
  verb: w.verb ?? w.svo?.v,
  object: w.object ?? w.svo?.o,
}));

/** Bundled official source list plus legacy demo books. */
export const WORD_BOOKS: WordBook[] = [
  { id: NGSL_BOOK_ID, name: "NGSL 1.2", desc: "New General Service List · 2,809 词 · CC BY-SA 4.0", words: NGSL_WORDS, source: "official" },
  { id: "core", name: "核心词汇", desc: "常见学术与通用高频词", words: tag("core", core), source: "official", demo: true },
  { id: "daily", name: "日常生活", desc: "生活场景里最常用的词", words: tag("daily", daily), source: "official", demo: true },
  { id: "business", name: "职场商务", desc: "工作与商务沟通词汇", words: tag("business", business), source: "official", demo: true },
];

export const isBundledBook = (id: string) => WORD_BOOKS.some((b) => b.id === id);

export const getBook = (id: string): WordBook => WORD_BOOKS.find((b) => b.id === id) ?? WORD_BOOKS.find((b) => b.id === "core")!;

/** Look up a bundled entry in its own book, without crossing book boundaries. */
export const findInBundledBook = (bookId: string, word: string): WordEntry | undefined =>
  WORD_BOOKS.find((b) => b.id === bookId)?.words.find((w) => w.word.toLowerCase() === word.toLowerCase());

/** 仅有英文单词时构造最小词条 */
export const bareEntry = (word: string, bookId?: string, cn?: string | null): WordEntry => ({
  word,
  bookId,
  cn: cn ?? undefined,
});

export const hasMeaning = (e: WordEntry): e is MeaningfulEntry => !!e.cn?.trim();
export const hasSentence = (e: WordEntry): e is SentenceEntry => !!e.sentence?.trim();

export const TOTAL_WORDS = WORD_BOOKS.reduce((n, b) => n + b.words.length, 0);

export const ALL_WORDS: WordEntry[] = WORD_BOOKS.flatMap((b) => b.words);

const WORD_INDEX = new Map(ALL_WORDS.map((w) => [w.word.toLowerCase(), w]));

export const findWord = (word: string): WordEntry | undefined => WORD_INDEX.get(word.toLowerCase());

/** Build a queue of entries from a list of words, skipping unknown ones. */
export const entriesFor = (words: string[]): WordEntry[] =>
  words.map((w) => findWord(w)).filter((e): e is WordEntry => !!e);

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
