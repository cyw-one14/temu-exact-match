# 快速特征匹配试验结果

日期：2026-10-09。已把 SIFT 快速核验接入后续图像核对。

前期图搜和页面图片匹配保持原流程。后续用已提取的参考主体进行特征、几何、颜色和局部结构检查；快速通过时跳过候选的 BiRefNet / DINOv2，否则继续原模型。首次参考主体提取仍需要模型，之后复用缓存。价格、原标题和链接仍取已抓取页面，不打开商品详情页。

## 实测

| 测试 | 结果 |
|---|---|
| 手套 JPEG 压缩、二维旋转 | 快速通过，特征核验约 60–68 ms |
| 牙膏挤压器 JPEG 压缩 | 快速通过，特征核验约 126 ms |
| 换色、修改结构、共享包装、缺少商品、空白图 | 11 个 SIFT 负例均未被快速通过 |
| 小尺寸换背景手套、裁切后旋转的挤压器 | 快速证据不足，继续原模型 |

共比较 24 个算法 / 样本组合。AKAZE 在当前严格条件下未产生可采用的快速结果。SIFT 的 16 个样本中，5 个正例有 3 个快速通过，11 个负例无快速通过。样本是两类真实商品图片及其合成变化，不是全品类或真实新相机视角准确率测试。

首次粗局部检查曾误通过白色挤压器的一小块结构改动。增加细粒度中性区域纹理检查后，此负例已被拦在快速通道之外；回归样本保存在 tests/fixtures/features。

## 实际商品图片接口

牙膏挤压器：800px AVIF 参考与 400px JPEG 候选，刻意不提供同资源 URL 证据。

- 前一次新候选走主体模型：18,943 ms。
- SIFT 通道完成 /compare：927 ms，包含候选下载；参考主体已有缓存。
- samePhoto=false、fastMatch=true、candidate subject=null，证实没有运行候选主体模型。
- 完整木纹背景手套仍未快速通过，保留原模型。

因此该优化能加快部分图片，不能保证 40 张陌生照片都秒级完成。快速失败不是商品被排除；原模型的核对能力和局限仍保留。

## 交付与检查

- 本机离线常驻 Python / OpenCV 核验进程已准备，依赖在 .cache/feature-runtime。
- 支持故障降级，不改变现有页面数据读取和数量 / 规格规则。
- 完整既有及新增检查 66 项通过，最终相关范围 12 项通过。
- 接口与试验数据：.cache/subject-validation/fast-api-report.json、feature-trial.json。
- 安装包资源校验通过，当前服务策略 page-first-v7。

参考：[MaaFramework 特征匹配实现](https://github.com/MaaXYZ/MaaFramework/blob/main/source/MaaFramework/Vision/FeatureMatcher.cpp)、[OpenCV 特征匹配与几何核验教程](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html)。
