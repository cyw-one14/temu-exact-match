# 浏览器内置识别 · 0.3.0

同事只需解压完整ZIP并在Chrome/Edge加载含manifest.json的目录。不需要Node服务、Python安装、云端密钥或启动脚本。新侧栏和设置页不再访问43187；旧服务源码及本机启动项保留用于旧版和开发。

## 运行链路

侧栏通过engine-client.mjs启动本扩展的专用Worker。Worker加载包内Transformers.js / ONNX Runtime Web / Pyodide，逐项运行原页面图片初筛、主体、适用的颜色和轮廓补充。关闭侧栏、停止或换图会终止Worker的在途计算；重新打开按会话进度恢复，模型重新准备。多个窗口的Worker各自占用内存。

- 分割：BiRefNet-lite 512 fp32，固定导出`studioludens/birefnet-lite-512@962e67969ec6acec9c19fab76acee4f5e22e990c`。作者来源和许可证随包提供。
- 特征：原DINOv2-small q8，固定c2bb04a；人体语义关注：原CLIPSeg q8，固定924dc94。
- 图像缩放/编码由OffscreenCanvas适配，保留原输入字节，在独立画布比较。
- SIFT、实例、轮廓使用Pyodide0.28.3 / OpenCV4.11.0.86 / NumPy2.2.5；直接打包server中的三份Python核验源码，通过固定JSON操作分发。不接受页面提供的Python代码。
- 全部推理使用WASM，单线程以适应扩展页面的隔离策略；不依赖WebGPU。运行时只允许包内模型、代码和固定官方图片来源。

主体/颜色/轮廓门槛和title-groups-outline-v16顺序保持。分割输入从旧1024改为512、Canvas缩放和OpenCV版本变化可能改变掩码及最终结果，不能把它称为与Node版完全相同的识别效果。原1024导出在实际浏览器推理中失败，512的fp16/WebGPU尝试在本样本产生空掩码，因此均未交付。fp32/WASM512实测参考分割覆盖约0.4134，镜像样本通过主体及方向核对；不同商品未进入同款。

## 数据与缓存

仍仅使用已抓取图片和正常页面信息，不自动打开详情页。官方图片仅从HTTPS kwcdn.com / temu.com及其子域下载，省略认证信息、拒绝重定向，限制8MB与40M像素；本地上传仍限制既有格式和大小。原图、手和原分割不删除，人体关注只调整比较权重。

参考/候选主体特征保存在独立带模型与预处理版本的IndexedDB中，30天/最多256条，读入时校验向量与结构；损坏/过期/写入失败时重新计算。与Node的.cache缓存隔离。长期人工分类仍由后台worker排队写storage.local；不与特征缓存混用，不保存照片/标题/价格，不云同步。

模型与代码随包，不对外发送图片进行识别；正常图搜仍把所选公开图片URL、商品ID和原标题放入第三方查询网址，上传本地图片仍由用户在第三方页面操作。各人需要正常的第三方访问权限。

## 构建与检查

`browser/model-lock.json`固定所有模型版本、文件大小和SHA-256。prepare-browser-assets校验资源、Pyodide锁文件摘要并拷贝固定Python源，拒绝未列入清单的生成文件；esbuild构建原匹配流程及浏览器适配，shared模块由package同步。ZIP流式压缩，支持大模型与子目录；显式根文件清单位于browser/package-files.json。

`python scripts/verify-package.py`校验ZIP、模型/资产摘要、Python源码一致性、稳定扩展ID、MV3安全策略及无localhost依赖。模型、vendor、Python副本、bundle、ZIP和用户缓存不提交Git；许可证源与固定摘要提交。仅构建阶段需要外部下载，最终包运行时不下载模型或远程可执行代码。CSP使用`wasm-unsafe-eval`以允许WebAssembly，不使用`unsafe-eval`。

`node scripts/browser-preflight-server.mjs`在43212提供独立验证页，使用本地历史图片及实际生产Worker/客户端，不请求账号或43187。它是开发验证服务器，不打入安装包。图片样本在.cache中，不提交或分发；需要现有本地验证素材才能运行。测试页面与用户图搜数据隔离。

自动测试和本地图片集只说明被测链路与规则可运行。安装后的扩展权限环境、真实账号下第三方页面、不同电脑内存/浏览器及真实跨拍摄图像仍需实际使用验证，不保证全品类准确率或穷尽全站。
