// 这个行业的分类体系：类别、标签词表、机构/公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 */
export const CATEGORIES = [
  { key: "clinical", label: "临床", section: "临床与科研", guide: "诊疗进展、指南共识更新、临床实践、专科动态、病例与诊疗方案变化" },
  { key: "research", label: "科研", section: "临床与科研", guide: "期刊论文、基础与转化研究、科研方法、数据集与学术成果" },
  { key: "edu", label: "医学教育", section: "临床与科研", guide: "医学教育、住院医师规培、继续教育、医学考试与学科建设" },
  { key: "drug", label: "药品", section: "药品与器械", guide: "创新药、仿制药、药品研发进展、上市、撤市、降价、集采中选" },
  { key: "device", label: "器械", section: "药品与器械", guide: "医疗器械注册、审批、上市、召回、耗材与设备动态" },
  { key: "medai", label: "医疗AI", section: "数字医疗与AI", guide: "医疗 AI 产品与算法、数字疗法、医疗大模型、互联网医院与数字医疗平台" },
  { key: "policy", label: "政策监管", section: "政策·医保与监管", guide: "NMPA/FDA/EMA 等监管决定、卫健委与医保局政策、医保目录、集采规则、支付改革" },
  { key: "hospital", label: "医院医保", section: "政策·医保与监管", guide: "医院管理改革、DRG/DIP、医保基金运行、医院运营与医联体" },
  { key: "pubhealth", label: "公共卫生", section: "公共卫生与国际", guide: "传染病防控、突发公共卫生事件、疾控监测、重大疾病与慢病防控" },
  { key: "intl", label: "国际医疗", section: "公共卫生与国际", guide: "海外医疗市场、国际组织动态、跨国注册与国际合作" },
  { key: "industry", label: "医药产业", section: "医药产业与资本", guide: "药企与器械企业经营、融资并购、CRO/CDMO、供应链、人事与产能" },
  { key: "tip", label: "科普", section: "综合与观点", guide: "医学科普、患者教育、健康传播、指南与论文的通俗解读、医学知识讲解" },
  { key: "general", label: "综合", section: "综合与观点", guide: "跨领域综述、人物观点、行业评论、无法归入以上任何一类的医疗内容" },
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["regulatory_action", "clinical_study", "research_paper", "market_event", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "监管审批", "临床研究", "指南共识", "论文研究", "药品动态", "器械动态", "医疗AI", "政策医保", "医院动态", "产业资本", "公共卫生", "医学教育", "科普观点", "其他",
] as const;

/** 可选的标签，两组语义：专科（0–2 个）+ 内容类型（0–2 个）。 */
export const TOPIC_TAGS = [
  // 专科
  "心血管", "肿瘤", "神经", "呼吸", "消化", "感染", "内分泌", "血液", "肾脏", "儿科", "妇产", "急诊", "重症", "骨科", "眼科", "皮肤", "麻醉", "检验", "影像", "病理",
  // 内容类型
  "政策发布", "临床试验", "随机对照试验", "Meta分析", "观察性研究", "注册审批", "药品上市", "药品撤市", "集采", "医保", "医疗器械", "AI产品", "医院改革", "投融资并购", "公共卫生事件", "国际动态", "科普", "评论",
] as const;

/** 可选的实体标签（监管机构、期刊、公司）。 */
export const ENTITY_TAGS = ["NMPA", "FDA", "EMA", "国家卫健委", "国家医保局", "中国CDC", "WHO", "NEJM", "The Lancet", "BMJ", "JAMA", "辉瑞", "默沙东", "诺华", "阿斯利康", "百济神州", "恒瑞医药", "药明康德", "迈瑞医疗", "联影", "腾讯医疗", "百度健康"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  监管: "监管审批", 审批: "监管审批", 批准: "监管审批", 获批: "监管审批", 受理: "监管审批", 召回: "监管审批",
  临床: "临床研究", 试验: "临床研究", 循证: "临床研究",
  指南: "指南共识", 共识: "指南共识", 专家共识: "指南共识",
  论文: "论文研究", 研究: "论文研究", 基础: "论文研究", 基础研究: "论文研究", paper: "论文研究", papers: "论文研究",
  药物: "药品动态", 药品: "药品动态", 新药: "药品动态", 上市: "药品动态", 集采中选: "药品动态",
  器械: "器械动态", 设备: "器械动态", 耗材: "器械动态",
  "AI": "医疗AI", 数字疗法: "医疗AI", 大模型: "医疗AI",
  政策: "政策医保", 医保: "政策医保", 目录: "政策医保", 报销: "政策医保",
  医院: "医院动态", 医改: "医院动态", DRG: "医院动态", DIP: "医院动态",
  公卫: "公共卫生", 疾控: "公共卫生", 疫情: "公共卫生", 传染病: "公共卫生",
  教育: "医学教育", 规培: "医学教育", 考研: "医学教育",
  融资: "产业资本", 并购: "产业资本", 收购: "产业资本", 敲钟: "产业资本", 上市融资: "产业资本",
  科普: "科普观点", 观点: "科普观点", 评论: "科普观点", 访谈: "科普观点", 解读: "科普观点", 趋势: "科普观点", 现象: "科普观点",
  肿瘤科: "肿瘤", 心血管内科: "心血管", 神经科: "神经", 呼吸科: "呼吸", 消化科: "消化", 感染科: "感染",
  国际: "公共卫生", 海外: "国际动态",
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  regulatory_action: "监管审批", clinical_study: "临床研究", research_paper: "论文研究",
  market_event: "药品动态", industry_event: "产业资本", opinion_analysis: "科普观点", tutorial_explainer: "科普观点",
};

// ── 机构与公司主体 ──────────────────────────────────────────────────────────────────────

/** 主体：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  nmpa: { name: "NMPA 国家药监局", displayTag: "NMPA", aliases: ["NMPA", "国家药监局", "药监局", "国家药品监督管理局", "CDE", "药审中心"] },
  fda: { name: "FDA", displayTag: "FDA", aliases: ["FDA", "美国食药监局", "美国食品药品监督管理局"] },
  ema: { name: "EMA", displayTag: "EMA", aliases: ["EMA", "欧洲药监局", "欧洲药品管理局"] },
  nhc: { name: "国家卫健委", displayTag: "国家卫健委", aliases: ["国家卫健委", "卫健委", "国家卫生健康委员会"] },
  nhsa: { name: "国家医保局", displayTag: "国家医保局", aliases: ["国家医保局", "医保局", "国家医疗保障局"] },
  cdc: { name: "中国疾控中心", displayTag: "中国CDC", aliases: ["中国CDC", "中国疾控中心", "疾控中心", "中疾控"] },
  who: { name: "WHO", displayTag: "WHO", aliases: ["WHO", "世界卫生组织", "世卫组织"] },
  nejm: { name: "NEJM", displayTag: "NEJM", aliases: ["NEJM", "新英格兰医学杂志"] },
  lancet: { name: "The Lancet", displayTag: "The Lancet", aliases: ["The Lancet", "柳叶刀", "Lancet"] },
  bmj: { name: "BMJ", displayTag: "BMJ", aliases: ["BMJ", "英国医学杂志"] },
  jama: { name: "JAMA", displayTag: "JAMA", aliases: ["JAMA", "美国医学会杂志"] },
  pfizer: { name: "Pfizer 辉瑞", displayTag: "辉瑞", aliases: ["Pfizer", "辉瑞"] },
  msci: { name: "Merck 默沙东", displayTag: "默沙东", aliases: ["Merck", "MSD", "默沙东"] },
  novartis: { name: "Novartis 诺华", displayTag: "诺华", aliases: ["Novartis", "诺华"] },
  astra: { name: "AstraZeneca 阿斯利康", displayTag: "阿斯利康", aliases: ["AstraZeneca", "阿斯利康", "AZ"] },
  beigene: { name: "BeiGene 百济神州", displayTag: "百济神州", aliases: ["BeiGene", "百济神州"] },
  hengrui: { name: "Hengrui 恒瑞医药", displayTag: "恒瑞医药", aliases: ["恒瑞医药", "恒瑞", "Hengrui"] },
  wuxi: { name: "WuXi 药明康德", displayTag: "药明康德", aliases: ["药明康德", "WuXi", "药明生物"] },
  mindray: { name: "Mindray 迈瑞医疗", displayTag: "迈瑞医疗", aliases: ["迈瑞医疗", "迈瑞", "Mindray"] },
  unit: { name: "United Imaging 联影", displayTag: "联影", aliases: ["联影", "United Imaging", "联影医疗"] },
  tencentmed: { name: "腾讯医疗", displayTag: "腾讯医疗", aliases: ["腾讯医疗", "腾讯健康", "觅影"] },
  baiduhealth: { name: "百度健康", displayTag: "百度健康", aliases: ["百度健康", "百度医疗", "灵医智惠"] },
};

/**
 * 身份词典：摘要和标题里出现的机构/公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "nmpa", name: "NMPA", patterns: [/nmpa|国家药监局|国家药品监督管理局|药监局|药审中心/i] },
  { id: "fda", name: "FDA", patterns: [/\bfda\b|美国食药监局|美国食品药品监督管理局|食药监局/i] },
  { id: "ema", name: "EMA", patterns: [/\bema\b|欧洲药监局|欧洲药品管理局/i] },
  { id: "nhc", name: "国家卫健委", patterns: [/国家卫健委|卫健委|国家卫生健康委员会/i] },
  { id: "nhsa", name: "国家医保局", patterns: [/国家医保局|医保局|国家医疗保障局/i] },
  { id: "cdc", name: "中国疾控中心", patterns: [/中国cdc|中国疾控中心|疾控中心|中疾控/i] },
  { id: "who", name: "WHO", patterns: [/\bwho\b|世界卫生组织|世卫组织/i] },
  { id: "nejm", name: "NEJM", patterns: [/\bnejm\b|新英格兰医学杂志/i] },
  { id: "lancet", name: "The Lancet", patterns: [/\blancet\b|柳叶刀/i] },
  { id: "bmj", name: "BMJ", patterns: [/\bbmj\b|英国医学杂志/i] },
  { id: "jama", name: "JAMA", patterns: [/\bjama\b|美国医学会杂志/i] },
  { id: "pfizer", name: "Pfizer 辉瑞", patterns: [/\bpfizer\b|辉瑞/i] },
  { id: "msci", name: "Merck 默沙东", patterns: [/\bmerck\b|\bmsd\b|默沙东/i] },
  { id: "novartis", name: "Novartis 诺华", patterns: [/\bnovartis\b|诺华/i] },
  { id: "astra", name: "AstraZeneca 阿斯利康", patterns: [/astra\s?zeneca|阿斯利康/i] },
  { id: "beigene", name: "BeiGene 百济神州", patterns: [/\bbeigene\b|百济神州/i] },
  { id: "hengrui", name: "恒瑞医药", patterns: [/恒瑞|hengrui/i] },
  { id: "wuxi", name: "药明康德", patterns: [/药明|wuxi/i] },
  { id: "mindray", name: "迈瑞医疗", patterns: [/迈瑞|mindray/i] },
  { id: "unit", name: "联影", patterns: [/联影|united\s?imaging/i] },
  { id: "tencentmed", name: "腾讯医疗", patterns: [/腾讯医疗|腾讯健康|觅影/i] },
  { id: "baiduhealth", name: "百度健康", patterns: [/百度健康|百度医疗|灵医智惠/i] },
];

/** 这些域名上的文章，发布方就是对应的机构（托管平台如 arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "nmpa", domains: ["nmpa.gov.cn"] },
  { entityId: "fda", domains: ["fda.gov"] },
  { entityId: "ema", domains: ["ema.europa.eu"] },
  { entityId: "nhc", domains: ["nhc.gov.cn"] },
  { entityId: "nhsa", domains: ["nhsa.gov.cn"] },
  { entityId: "cdc", domains: ["chinacdc.cn"] },
  { entityId: "who", domains: ["who.int"] },
  { entityId: "nejm", domains: ["nejm.org"] },
  { entityId: "lancet", domains: ["thelancet.com"] },
  { entityId: "bmj", domains: ["bmj.com"] },
  { entityId: "jama", domains: ["jamanetwork.com"] },
  { entityId: "pfizer", domains: ["pfizer.com"] },
  { entityId: "msci", domains: ["merck.com"] },
  { entityId: "novartis", domains: ["novartis.com"] },
  { entityId: "astra", domains: ["astrazeneca.com"] },
  { entityId: "beigene", domains: ["beigene.com"] },
  { entityId: "hengrui", domains: ["hengrui.com.cn"] },
  { entityId: "wuxi", domains: ["wuxiapptec.com"] },
  { entityId: "mindray", domains: ["mindray.com"] },
  { entityId: "unit", domains: ["united-imaging.com", "unit-imaging.com"] },
];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "nmpa", pattern: /国家药品监督管理局/i },
  { entityId: "msci", pattern: /默沙东|merck/i },
];
