# TEMU 同款、销量 Top 10 与关键词：GitHub 调研

核查日期：2026-10-10（Asia/Shanghai）。本次仅查阅公开仓库、部分核心源码、API 定义和许可证；未安装项目、未调用付费接口、未上传产品图片、未验证这些服务的实际账号结果。不能据仓库介绍宣称识别准确率或全站数据完整。

## 结论

本次检索未找到可直接安装、完整满足“上传图片 → TEMU 美国站同款自动确认 → 同口径销量前十 → 最畅销链接 → 每个链接真实常用搜索词”的免费、自带数据的开源浏览器插件。可组合的组件存在。最接近业务需求的是 GeekBI 的公开 MCP 客户端及 LinkFox 的 MIT 接口脚本；数据和图搜来自第三方服务，不是仓库自带的 TEMU 数据库。

建议保留当前 MV3 插件与本机 Node 服务，增加可选数据源、实例定位/特征核验和 Top 10 展示。没有发现值得替换当前整个项目的完整应用底座。

## 候选与缺口

| 项目 | 已核实的部分能力 | 可接入的位置 | 主要缺口 |
| --- | --- | --- | --- |
| [GeekBI TEMU Research MCP](https://github.com/geekbi/geekbi-temu-research-mcp) | 图片输入、图搜、商品/销量查询、站点、关键词；图搜输入继承销量排序和分页参数 | server 新增数据源适配，复用现有标准商品结构 | 第三方账号/权限依赖；不是插件；未见根目录 LICENSE；没有已证实的商品级搜索词归因接口 |
| [LinkFox Skills](https://github.com/linkfox-ai/linkfox-skills) | TEMU 图片搜索脚本、日/周/月销量和价格字段、市场关键词接口；MIT | 可复用客户端组织方式；将响应映射进现有面板 | 图搜需上传其 OSS、API Key、按算力计费；图搜端点无国家站/分页/排序参数，不能假定美国站或全站覆盖 |
| [LightGlue](https://github.com/cvg/LightGlue) / [LightGlue-ONNX](https://github.com/fabio-sim/LightGlue-ONNX) | 图像对局部特征对应；ONNX 部署方案 | server/fast-features.mjs 与独立核验进程的可选匹配器 | 不提供 TEMU 候选或销量；特征对应不等于商品同款；需保留商品区域、覆盖和细节校验 |
| [Grounded SAM 2](https://github.com/IDEA-Research/Grounded-SAM-2) | 组合文本目标检测与分割 | 后续主体核对中寻找多件图里的单个产品；原图不改，只提供比较掩码 | 不是同款判断器；需评估模型大小、本机延迟、遮挡及实例拆分效果 |
| [Same](https://github.com/Ps23102004/same) | 本地图像对象检索；区域金字塔 DINOv2 召回与 SIFT 几何验证；MIT | 参考多尺度区域、重复对象对应与评测设计 | 本地图库应用，没有 TEMU 数据；查询要求用户框选；仓库明确未验证三维视角变化，不能视为已解决我们的跨摄影样本 |
| [KeyBERT](https://github.com/MaartenGr/KeyBERT) | 从已有文本提取短语；MIT | 每个 Top 10 商品的原标题/已抓取描述短语整理 | 提取的是文本词，不是这个链接的真实买家搜索词、搜索量或成交归因 |

LightGlue 官方代码/权重为 Apache-2.0；其 README 单独提示 SuperPoint 许可证有额外限制，DISK 为 Apache-2.0、ALIKED 为 BSD-3-Clause。试验优先选择 DISK 或 ALIKED 组合，记录所有组件的许可证与版本，不把 matcher 的许可当作全部提取器许可。[官方说明](https://github.com/cvg/LightGlue#license)

## 两条数据接入路径的区别

GeekBI 原生客户端直接调用 openapi.geekbi.com。ImageSearchInput 支持本地路径、Data URI、带前缀 Base64 和公开 URL，经客户端读图后 multipart 上传。继承的筛选参数包括 siteId、page、size、sort 和 order，销量排序支持 sold/daySold/weekSold/monthSold；美国站默认 siteId=48。源码接口存在不等于实际账号一定有访问权或数据保证。[输入定义](https://github.com/geekbi/geekbi-temu-research-mcp/blob/master/src/geekbi_temu_mcp/models.py)、[客户端](https://github.com/geekbi/geekbi-temu-research-mcp/blob/master/src/geekbi_temu_mcp/client.py)

原生仓库根目录与 pyproject.toml 未找到明确 LICENSE，暂作为公开接口参考，不直接复制进产品。服务登录、授权、计费与可用字段需要实际账号验证；没有据代码推断免费额度或套餐费用。

LinkFox 网关是另一套契约。图搜只接受上传至其 OSS 的图片 URL；文档标注一次图搜 150 算力，不是人民币价格。返回 sold/daySold/weekSold/monthSold 等字段后可在本机排序，但图搜无国家站参数。它的商品/市场接口使用 regionId，美国默认211，不能与原生 siteId=48混用。必须确认图搜结果市场归属，否则不能列作美国站销量排名。[图搜契约](https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-geekbi-temu-search-by-image/references/api.md)、[市场接口](https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-geekbi-temu-market-research/SKILL.md)

两者的图搜返回都只能作为同款候选，不能据“图搜同款”这个接口名称认定主体一模一样。数据提供者销量的采集口径、是否估算、更新延迟和覆盖范围也需验证。

## 关键词的关键缺口

公开定义中的关键词查询按 keyword/catIds 搜索市场需求，没有商品 goodsId 参数来返回该链接实际带来流量或成交的词。[GeekBI 输入模型](https://github.com/geekbi/geekbi-temu-research-mcp/blob/master/src/geekbi_temu_mcp/models.py)、[LinkFox 市场词接口](https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-geekbi-temu-market-research/SKILL.md)

因此必须分开标注：商品页面明确关键词、从该链接原标题/描述提取的短语、市场相关词、商品真实流量/成交词。最后一类目前没有找到已证实可对其他卖家任意链接获取的开源接口；不能把前三类改名为“该商品常用成交搜索词”。KeyBERT 的文本提取能够补充第二类，不能提供第四类。[KeyBERT 原理](https://github.com/MaartenGr/KeyBERT#about-the-project)

## 不适合作为整体底座的抓取项目

- [ScrapeUnblocker/temu-scraper](https://github.com/ScrapeUnblocker/temu-scraper)：MIT Node 客户端，依赖其 API Key。支持关键词搜索和价格/标题/品牌/图片等详情，但 normalizeProduct 中没有销量字段；best_selling 排序名不能替代可核查销量，也没有图片同款和商品级搜索词。与当前 Node 环境相容，但不是解决销量缺口的首选。[核心源码](https://github.com/ScrapeUnblocker/temu-scraper/blob/main/src/client.js)
- [n1ceh4t/Temu-Item-Scraper](https://github.com/n1ceh4t/Temu-Item-Scraper)：侧重导入 WooCommerce，README 自述可能无法按描述运行；与同款分析侧栏的业务不同。
- [FarisAshhab/temu-product-scraper](https://github.com/FarisAshhab/temu-product-scraper)：Selenium/Flask 季节活动页抓取，公开能力为名称、价格、评分和图片；未提供同款图搜、销量排名或搜索词归因。README 声明 MIT，但根目录未见单独 LICENSE 文件。

## 对当前代码的整合建议

以下为后续方案，本次没有修改运行功能。

1. 数据源优先验证原生 GeekBI 美国站图搜。将标题、原价格、链接、图片、销量周期/原值/更新时间与提供者身份映射到现有商品结构。凭证留本机服务；使用 API 获取候选，保持不自动打开候选详情页。
2. 标题优先作为排序/召回提示，保留缺标题的图片路径。主体核验与当前标题/配色推定分层；不同数量不排除。多件图采用 GroundingDINO + SAM 2 的实例掩码试验，原图/原前景不删手，再用 LightGlue 可选核验。
3. 先收集和核验足够候选，再按同市场、同来源、同周期销量取前十，突出第一名。不能只取图搜最前十再宣称销量前十；未确认销量不填零、不用评论数替代，非全量覆盖时只能称“已获取同款中的前十”。
4. 前十个链接逐条展示原价、原标题、链接、销量原值/周期和关键词来源。当前 shared/core.mjs 的 bestSellerKeywords 默认 topCount=3，虽然支持传10，面板仍需调整展示与每链接词列表；当前规则提取标题分句，可再比较 KeyBERT 短语提取效果。真实搜索流量词必须另找有商品关联证据的数据源。
5. 验证集使用现有手套/梳子的不同数量、镜像、跨拍摄、手部遮挡正例，以及同品牌/同色不同结构、局部商标负例。测误确认与漏确认、首次/缓存时延及数据完整性；外部仓库的场景基准不能替代这些实物商品测试。

接入顺序建议：先验证数据源的市场、销量和商品词关联能力，再比较 LightGlue；实例定位作为独立可选试验。仅为了显示十行结果重写插件，无法解决数据覆盖和同款识别问题。
