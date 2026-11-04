# 友链背景 / Friend-card backgrounds

友链卡片原先把头像放大裁剪后直接降低透明度，照片纹理和插画轮廓会在文字背后形成杂纹。现在背景使用轻度模糊、独立渐变遮罩，并向外扩展图像以避免模糊边缘出现接缝；深浅色分别调整透明度。圆形头像保持原图清晰显示。

所有友链共用此样式，继续使用配置中的外部头像地址，不增加图片副本。名称、介绍、排序、跳转与悬浮箭头保持原有行为。

Friend-card backgrounds now soften the original image before fading it into the card. A separate mask and overscan avoid edge seams; the foreground avatar stays sharp. External avatar URLs, content and interactions remain unchanged.

验收：13 项友链相关测试通过；独立生产构建及 53 页元数据检查通过。Edge 检查桌面、430px 和 320px 手机模拟尺寸、中英文、深浅色，未发现横向溢出。未修改账号、留言或编辑副本。
