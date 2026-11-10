# 具身数据 · 14类精选样本库

公开演示站点，纯HTML/CSS/JavaScript，无数据库或服务端运行依赖。

[在线浏览](https://tairitsu-aya.github.io/embodied-data-demo/) · [来源视频下载](https://github.com/Tairitsu-Aya/embodied-data-demo/releases/tag/v1.0.0)

- 14个业务大类各1段，保留细分类，共42分44.497秒。
- 500条动作标注，76,883帧源几何数据，9个单目/5个双目样本。
- `media/`：去重后的19份骨架预览；`raw/`：完整动作、标定和几何JSON；`derived/`：低帧率展示几何；`catalog.json`：完整选样元数据。
- 19路来源视频保留原编码，发布在同仓库v1.0.0 Release；下载地址与SHA-256见 `source-files.json`，网页数据详情中也可下载。
- 原始MCAP没有可用公开下载入口，不在本数据包中。

注意：手部/相机几何为源数据估计结果，有效帧标记不代表精度。main与左目骨架存在同文件别名，网页已去重。来源画质包含HEVC高分辨率画面与低分辨率服务代理，按真实分辨率显示。

来源片段按源时间窗stream-copy保留编码包；部分视频尾部最多多0.167秒，容器时间码尾部最多多0.701秒，详情保留在每条来源的alignmentVerification中。展示时间线始终按所选标注片段计时。

## 发布

GitHub仓库Settings → Pages → Deploy from a branch → main / root。`.nojekyll`避免静态文件被转换。所有路径支持项目子目录部署。

公开可访问不等于开放许可；仓库未自动授予数据再分发或商业使用许可，相关授权由数据权利人另行约定。
